/* ============================================================
   panel.ts — panel run orchestration over working UNITS.

   A "unit" is a catalogue segment (with any persona overrides applied) or a
   bring-your-own custom persona — both resolved by resolvePanelUnits(req) and
   carrying a structured `persona` spec plus a stable id/name/colour.

   - live:false        -> samplePanel(req) (offline, deterministic).
   - live:true, no ai  -> samplePanel(req) flagged fellBack with a note.
   - live:true, ai     -> per unit, in parallel (Promise.allSettled):
        1. sample N seeded sub-personas from the unit's spec,
        2. elicit one reaction per sub-persona with Gemini (situation+text+driver),
        3. SSR-map each reaction's text to a Likert pmf (embedding cosine),
        4. aggregate into a SegmentResult (responses carry `situation`).
     ANY unit failure -> that unit falls back to sampleSegment (persona-aware,
     carries situation). A unit with no spec uses sampleSegment directly.

   The endpoint must NEVER throw a 5xx for an LLM failure — every path degrades
   to deterministic sample data.
   ============================================================ */

import type { GoogleGenAI } from "@google/genai";
import {
  aggregate,
  makeRng,
  resolveConceptForPanel,
  resolvePanelUnits,
  sampleRespondentsFromVariants,
  samplePanel,
  samplePersonaVariants,
  sampleSegment,
} from "./domain.js";
import type {
  Concept,
  PanelRequest,
  PanelResponse,
  RespondentResult,
  Segment,
  SegmentResult,
} from "./domain.js";
import { elicitReactions } from "./vertex.js";
import { ssrMode, ssrReady, ssrTextsBatch, SSR_CONFIG } from "./ssr.js";
import { VERTEX_CONFIG } from "./vertex.js";

interface UnitOutcome {
  unitId: string;
  result: SegmentResult;
  live: boolean; // true if produced from real elicitation
}

/**
 * Run one unit live: sample sub-personas -> elicit reactions -> SSR-map -> aggregate.
 * Throws on any failure so the caller can fall back to sampleSegment.
 * A spec-less unit cannot be elicited (no persona to reason about) — caller
 * routes those through the offline path instead.
 */
async function runUnitLive(
  ai: GoogleGenAI,
  concept: Concept,
  unit: Segment,
  nPer: number,
  rng: ReturnType<typeof makeRng>
): Promise<UnitOutcome> {
  const spec = unit.persona;
  if (!spec) throw new Error(`unit ${unit.id} has no persona spec`);

  const variants = samplePersonaVariants(spec, nPer, rng);
  const reactions = await elicitReactions(ai, concept, unit, variants);

  const ssrResults = await ssrTextsBatch(
    ssrReady() ? ai : null,
    reactions.map((r) => r.text)
  );

  const responses: RespondentResult[] = reactions.map((r, i) => {
    const ssr = ssrResults[i];
    return { text: r.text, driver: r.driver, situation: r.situation, pmf: ssr.pmf, mean: ssr.mean };
  });

  // Contract: exactly nPer respondents. If Gemini returned fewer, top up with
  // the leftover (already-sampled) variants so the SAME people are used and the
  // topped-up respondents still carry a derived situation.
  if (responses.length < nPer) {
    const leftover = variants.slice(responses.length, nPer);
    responses.push(...sampleRespondentsFromVariants(concept, leftover, rng));
  }

  return { unitId: unit.id, result: { responses, ...aggregate(responses) }, live: true };
}

/** Deterministic, persona-aware fallback for one unit (carries situation). */
function runUnitSample(
  concept: Concept,
  unit: Segment,
  nPer: number,
  rng: ReturnType<typeof makeRng>
): UnitOutcome {
  const responses = sampleSegment(concept, unit, nPer, rng);
  return { unitId: unit.id, result: { responses, ...aggregate(responses) }, live: false };
}

/**
 * Full panel run. Decides sample vs live, fans out across units, and assembles
 * the canonical PanelResponse. Never rejects for an LLM error.
 */
export async function runPanel(
  ai: GoogleGenAI | null,
  req: PanelRequest
): Promise<PanelResponse> {
  const started = Date.now();

  // Explicit offline/sample mode.
  if (!req.live) {
    const base = samplePanel(req);
    return { ...base, meta: { ...base.meta, ms: Date.now() - started } };
  }

  // Live requested but no Vertex client configured -> sample, flagged as fallback
  // so the UI can tell the user live elicitation was unavailable.
  if (!ai) {
    const base = samplePanel(req);
    return {
      ...base,
      fellBack: true,
      meta: {
        ...base.meta,
        note: "Vertex not configured; returned offline sample data.",
        ms: Date.now() - started,
      },
    };
  }

  const concept = resolveConceptForPanel(req);
  const units = resolvePanelUnits(req);
  const baseSeed = req.seed ?? 7;
  const nPer = req.nPer;

  // Fan out across units; each settles independently. A unit with a spec is
  // elicited live; a spec-less unit (legacy) goes straight to the sample path.
  const settled = await Promise.allSettled(
    units.map((unit, idx) => {
      const rng = makeRng(baseSeed + idx * 1000 + unit.id.length);
      if (unit.persona) {
        return runUnitLive(ai, concept, unit, nPer, rng);
      }
      return Promise.resolve(runUnitSample(concept, unit, nPer, rng));
    })
  );

  const perSegment: Record<string, SegmentResult> = {};
  let anyLive = false;
  let anyFellBack = false;

  settled.forEach((res, idx) => {
    const unit = units[idx];
    if (res.status === "fulfilled") {
      perSegment[unit.id] = res.value.result;
      if (res.value.live) anyLive = true;
      else anyFellBack = true;
    } else {
      // Persona-aware fallback for this unit (carries situation). Re-derive the
      // same seeded RNG so the fallback matches the unit's intended people.
      const rng = makeRng(baseSeed + idx * 1000 + unit.id.length);
      perSegment[unit.id] = runUnitSample(concept, unit, nPer, rng).result;
      anyFellBack = true;
    }
  });

  const ms = Date.now() - started;

  // Nothing live succeeded -> behave exactly like a sample run.
  if (!anyLive) {
    const base = samplePanel(req);
    return {
      ...base,
      fellBack: true,
      meta: {
        ...base.meta,
        ssr: "lexical",
        note: "Vertex elicitation unavailable; returned offline sample data.",
        ms,
      },
    };
  }

  const ssr = ssrReady() ? ssrMode() : "lexical";
  const notes: string[] = [];
  if (anyFellBack) {
    notes.push("Some units degraded to offline sample data.");
  }
  if (!ssrReady()) {
    notes.push("Embedding SSR unavailable; reactions mapped with the lexical proxy.");
  }

  // personaReasoning: true if any response carries a model-derived situation.
  const personaReasoning = Object.values(perSegment).some((seg) =>
    seg.responses.some((r) => typeof r.situation === "string" && r.situation.length > 0)
  );

  return {
    mode: "live",
    fellBack: anyFellBack,
    perSegment,
    meta: {
      model: VERTEX_CONFIG.geminiModel,
      embedModel: SSR_CONFIG.embedModel,
      ssr,
      personaReasoning,
      units: units.map((u) => ({ id: u.id, name: u.name, color: u.color })),
      note: notes.length ? notes.join(" ") : undefined,
      ms,
    },
  };
}

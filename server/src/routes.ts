/* ============================================================
   routes.ts — the /api surface.

     GET  /api/health -> { status, vertex, ssr, ms }
     GET  /api/config -> { concepts, segments, anchors }
     POST /api/panel  -> PanelResponse (sample or live; never 5xx for LLM fail)
     POST /api/ssr    -> { pmf, mean, ssr } for one free-text verbatim
   ============================================================ */

import { Router } from "express";
import type { Request, Response } from "express";
import {
  ANCHORS,
  CONCEPTS,
  SEGMENTS,
  resolveConceptForPanel,
  resolvePanelUnits,
  ssrProxy,
} from "./domain.js";
import type {
  ChatMessage,
  CreditPosture,
  CustomPersona,
  Household,
  IncomeStability,
  PanelRequest,
  PanelResponse,
  PersonaSpec,
} from "./domain.js";
import { askUnitReply, chatReply, getVertexClient } from "./vertex.js";
import { offlineChatReply } from "./chat.js";
import { ssrMode, ssrReady, ssrText } from "./ssr.js";
import { runPanel } from "./panel.js";

// Re-export so callers can reach the offline fallback via the routes module too.
export { offlineChatReply };

const VALID_SEGMENT_IDS = new Set(SEGMENTS.map((s) => s.id));

// Bounds for user-controlled text injected into Gemini prompts (public endpoint).
const MAX_CONCEPT_TEXT = 1500;
const MAX_CONCEPT_NAME = 120;
const MAX_SSR_TEXT = 1500;

// Bounds for synthetic chat (public, billable endpoints).
const MAX_CHAT_MSG = 600; // chars per chat message / seed text
const MAX_CHAT_HISTORY = 16; // turns of history sent to the model
const MAX_ASK_UNITS = 8; // units that may answer a broadcast question
const MAX_ASK_QUESTION = 400; // chars of a broadcast question
const MAX_UNIT_NAME = 60; // chars of a chat unitName label

// Bounds for bring-your-own personas + overrides (public, billable endpoint).
const MAX_CUSTOM_PERSONAS = 3;
const MAX_PANEL_RESPONDENTS = 60; // hard cap on (units) * nPer
const MAX_PERSONA_NAME = 60;
const MAX_REGION_LEN = 60;
const MAX_PERSONA_NOTES = 400;
const MAX_LIFE_EVENTS = 6;
const MAX_LIFE_EVENT_LEN = 60;

// Whitelists for the structured persona unions.
const HOUSEHOLDS = new Set<Household>(["single", "couple", "family"]);
const INCOME_STABILITIES = new Set<IncomeStability>([
  "stable",
  "variable",
  "none",
  "windfall",
]);
const CREDIT_POSTURES = new Set<CreditPosture>(["averse", "mainstream", "reliant"]);

// A small default palette for BYO personas without an explicit colour.
const BYOP_PALETTE = ["#0F8B8D", "#E08D2F", "#7A4FB8"];

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

/** Parse a free-form lifeEvents value into a capped array of bounded strings. */
function parseLifeEvents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim().slice(0, MAX_LIFE_EVENT_LEN);
    if (s) out.push(s);
    if (out.length >= MAX_LIFE_EVENTS) break;
  }
  return out;
}

/**
 * Coerce an arbitrary value into a fully-populated, safe PersonaSpec. Every
 * field is clamped/whitelisted to a sane default; this NEVER throws.
 */
function parsePersonaSpec(raw: unknown): PersonaSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const household: Household = HOUSEHOLDS.has(r.household as Household)
    ? (r.household as Household)
    : "single";
  const incomeStability: IncomeStability = INCOME_STABILITIES.has(
    r.incomeStability as IncomeStability
  )
    ? (r.incomeStability as IncomeStability)
    : "stable";
  const creditPosture: CreditPosture = CREDIT_POSTURES.has(r.creditPosture as CreditPosture)
    ? (r.creditPosture as CreditPosture)
    : "mainstream";
  return {
    age: clampInt(r.age, 18, 90, 35),
    region: typeof r.region === "string" ? r.region.slice(0, MAX_REGION_LEN) : "",
    household,
    dependents: clampInt(r.dependents, 0, 8, 0),
    grossIncome: clampNum(r.grossIncome, 0, 2_000_000, 0),
    incomeStability,
    liquidAssets: clampNum(r.liquidAssets, 0, 5_000_000, 0),
    creditPosture,
    lifeEvents: parseLifeEvents(r.lifeEvents),
    notes: typeof r.notes === "string" ? r.notes.slice(0, MAX_PERSONA_NOTES) : "",
  };
}

/**
 * Coerce an arbitrary value into a Partial<PersonaSpec> containing ONLY the
 * keys that were actually provided, each clamped/whitelisted (for
 * segmentOverrides — light-editing an archetype). NEVER throws.
 */
function parsePartialPersonaSpec(raw: unknown): Partial<PersonaSpec> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<PersonaSpec> = {};
  if ("age" in r) out.age = clampInt(r.age, 18, 90, 35);
  if ("region" in r) out.region = typeof r.region === "string" ? r.region.slice(0, MAX_REGION_LEN) : "";
  if ("household" in r && HOUSEHOLDS.has(r.household as Household)) {
    out.household = r.household as Household;
  }
  if ("dependents" in r) out.dependents = clampInt(r.dependents, 0, 8, 0);
  if ("grossIncome" in r) out.grossIncome = clampNum(r.grossIncome, 0, 2_000_000, 0);
  if ("incomeStability" in r && INCOME_STABILITIES.has(r.incomeStability as IncomeStability)) {
    out.incomeStability = r.incomeStability as IncomeStability;
  }
  if ("liquidAssets" in r) out.liquidAssets = clampNum(r.liquidAssets, 0, 5_000_000, 0);
  if ("creditPosture" in r && CREDIT_POSTURES.has(r.creditPosture as CreditPosture)) {
    out.creditPosture = r.creditPosture as CreditPosture;
  }
  if ("lifeEvents" in r) out.lifeEvents = parseLifeEvents(r.lifeEvents);
  if ("notes" in r) out.notes = typeof r.notes === "string" ? r.notes.slice(0, MAX_PERSONA_NOTES) : "";
  return out;
}

/** Coerce an arbitrary request body into a safe PanelRequest. */
function parsePanelRequest(body: unknown): PanelRequest {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // Dedupe + whitelist segment IDs so a public caller cannot amplify cost by
  // sending the same valid ID many times (max = number of real segments).
  let segments: string[] = Array.isArray(b.segments)
    ? [
        ...new Set(
          (b.segments as unknown[]).filter(
            (s): s is string => typeof s === "string" && VALID_SEGMENT_IDS.has(s)
          )
        ),
      ]
    : [];
  // NB: do NOT default empty segments to "all catalogue" here — a BYO-only run
  // (custom personas, no catalogue segments) must not silently pull in the
  // archetypes. The default is applied below, only when NO units were requested.

  // Bound user-controlled text that is injected into Gemini prompts.
  const conceptId = typeof b.conceptId === "string" ? b.conceptId.slice(0, 64) : undefined;
  const conceptText =
    typeof b.conceptText === "string" ? b.conceptText.slice(0, MAX_CONCEPT_TEXT) : undefined;
  const conceptName =
    typeof b.conceptName === "string" ? b.conceptName.slice(0, MAX_CONCEPT_NAME) : undefined;

  let nPer = clampInt(b.nPer, 1, 12, 6);

  // Bring-your-own personas: up to MAX_CUSTOM_PERSONAS, each fully clamped and
  // assigned a stable server id, a bounded name and a default palette colour.
  const customPersonas: CustomPersona[] = Array.isArray(b.customPersonas)
    ? (b.customPersonas as unknown[]).slice(0, MAX_CUSTOM_PERSONAS).map((raw, i) => {
        const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const name =
          typeof r.name === "string" && r.name.trim()
            ? r.name.trim().slice(0, MAX_PERSONA_NAME)
            : `Custom persona ${i + 1}`;
        const color =
          typeof r.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color.trim())
            ? r.color.trim()
            : BYOP_PALETTE[i % BYOP_PALETTE.length];
        return {
          id: `__byop_${i}__`,
          name,
          color,
          spec: parsePersonaSpec(r.spec),
        };
      })
    : [];

  // Segment overrides: only for whitelisted segment ids; each value is a
  // partial persona spec (light-editing an archetype).
  let segmentOverrides: Record<string, Partial<PersonaSpec>> | undefined;
  if (b.segmentOverrides && typeof b.segmentOverrides === "object") {
    const src = b.segmentOverrides as Record<string, unknown>;
    const parsed: Record<string, Partial<PersonaSpec>> = {};
    for (const key of Object.keys(src)) {
      if (VALID_SEGMENT_IDS.has(key)) {
        parsed[key] = parsePartialPersonaSpec(src[key]);
      }
    }
    if (Object.keys(parsed).length > 0) segmentOverrides = parsed;
  }

  // Default to the full catalogue ONLY when no units were requested at all
  // (legacy clients / empty body). A BYO-only run keeps its empty segment list.
  if (segments.length === 0 && customPersonas.length === 0) {
    segments = SEGMENTS.map((s) => s.id);
  }

  // Hard cap: guarantee (units) * nPer <= MAX_PANEL_RESPONDENTS. Keep EVERY
  // selected unit — catalogue segments AND user-authored BYO personas — and
  // reduce respondents-per-unit to fit instead of dropping anyone. The unit
  // count is bounded (<= SEGMENTS + MAX_CUSTOM_PERSONAS = 8), so nPer >= 1
  // always fits and no unit is ever silently removed (the previous "drop BYO
  // personas first" behaviour made bring-your-own personas vanish from results).
  // The /panel handler surfaces a note when nPer was trimmed.
  const unitCount = segments.length + customPersonas.length;
  if (unitCount > 0 && unitCount * nPer > MAX_PANEL_RESPONDENTS) {
    nPer = Math.max(1, Math.floor(MAX_PANEL_RESPONDENTS / unitCount));
  }

  return {
    conceptId,
    conceptText,
    conceptName,
    segments,
    nPer,
    live: b.live === true,
    seed: typeof b.seed === "number" && Number.isFinite(b.seed) ? b.seed : undefined,
    customPersonas: customPersonas.length > 0 ? customPersonas : undefined,
    segmentOverrides,
  };
}

/**
 * Coerce an arbitrary value into a safe ChatMessage[]. Whitelists role to
 * {"user","persona"} and text to a non-empty string; trims + slices each text to
 * MAX_CHAT_MSG; drops empties; keeps only the LAST MAX_CHAT_HISTORY turns.
 * NEVER throws — a non-array or junk body yields [].
 */
function parseChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const role = r.role;
    if (role !== "user" && role !== "persona") continue;
    if (typeof r.text !== "string") continue;
    const text = r.text.trim().slice(0, MAX_CHAT_MSG);
    if (!text) continue;
    out.push({ role, text });
  }
  // Keep the most recent MAX_CHAT_HISTORY turns.
  return out.slice(-MAX_CHAT_HISTORY);
}

export function createApiRouter(): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    const started = Date.now();
    const vertex = getVertexClient() !== null && ssrReady();
    res.json({
      status: "ok",
      vertex,
      ssr: ssrMode(),
      ms: Date.now() - started,
    });
  });

  router.get("/config", (_req: Request, res: Response) => {
    res.json({
      concepts: CONCEPTS,
      segments: SEGMENTS,
      anchors: ANCHORS,
    });
  });

  router.post("/panel", async (req: Request, res: Response) => {
    const panelReq = parsePanelRequest(req.body);
    // Never silently swallow a respondent-cap adjustment: every selected unit
    // (incl. BYO personas) is kept; respondents-per-unit is trimmed to fit
    // MAX_PANEL_RESPONDENTS. Tell the user when that happened.
    const requestedNPer = clampInt(
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>).nPer
        : undefined,
      1,
      12,
      6
    );
    const cappedUnitCount = panelReq.segments.length + (panelReq.customPersonas?.length ?? 0);
    const capNote =
      panelReq.nPer < requestedNPer
        ? `Respondents per unit reduced from ${requestedNPer} to ${panelReq.nPer} to keep all ${cappedUnitCount} units within the ${MAX_PANEL_RESPONDENTS}-respondent panel cap.`
        : undefined;
    const withCapNote = (r: PanelResponse): PanelResponse =>
      capNote
        ? { ...r, meta: { ...r.meta, note: r.meta.note ? `${r.meta.note} ${capNote}` : capNote } }
        : r;
    try {
      const ai = getVertexClient();
      const result = await runPanel(ai, panelReq);
      res.json(withCapNote(result));
    } catch (err) {
      // Defensive: orchestration should never throw, but if it does we still
      // must not 5xx for an LLM failure. Degrade to offline sample data.
      // eslint-disable-next-line no-console
      console.warn(`[panel] unexpected error, returning sample: ${(err as Error).message}`);
      try {
        const fallback = await runPanel(null, { ...panelReq, live: false });
        res.json(withCapNote({ ...fallback, fellBack: true }));
      } catch (fatal) {
        // Last resort: even deterministic sample generation failed. Honour the
        // never-5xx contract with a minimal valid PanelResponse rather than
        // letting Express emit a 500.
        // eslint-disable-next-line no-console
        console.error(
          `[panel] sample fallback failed, returning empty panel: ${(fatal as Error).message}`
        );
        const empty: PanelResponse = {
          mode: "sample",
          fellBack: true,
          perSegment: {},
          meta: { ssr: "lexical" },
        };
        res.json(withCapNote(empty));
      }
    }
  });

  router.post("/ssr", async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
      string,
      unknown
    >;
    const text = (typeof body.text === "string" ? body.text : "").slice(0, MAX_SSR_TEXT);
    if (!text.trim()) {
      const { pmf, mean } = ssrProxy("");
      res.json({ pmf, mean, ssr: "lexical" });
      return;
    }
    try {
      const ai = getVertexClient();
      const result = await ssrText(ssrReady() ? ai : null, text);
      res.json(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[ssr] error, using lexical proxy: ${(err as Error).message}`);
      const { pmf, mean } = ssrProxy(text);
      res.json({ pmf, mean, ssr: "lexical" });
    }
  });

  // POST /api/chat — interview a single synthetic respondent (follow-ups).
  // Body: { conceptId?|conceptText?|conceptName?, persona, unitName?, seed?, messages }.
  // No-bill contract: with no usable persona OR no trailing non-empty USER
  // message (incl. a malformed body -> req.body={}), return the offline reply
  // WITHOUT calling Vertex. Otherwise try chatReply, falling back offline on any
  // failure. NEVER 5xx.
  router.post("/chat", async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
      string,
      unknown
    >;

    // Concept (resolveConceptForPanel does NOT cap these — slice here).
    const conceptId = typeof body.conceptId === "string" ? body.conceptId.slice(0, 64) : undefined;
    const conceptText =
      typeof body.conceptText === "string" ? body.conceptText.slice(0, MAX_CONCEPT_TEXT) : undefined;
    const conceptName =
      typeof body.conceptName === "string" ? body.conceptName.slice(0, MAX_CONCEPT_NAME) : undefined;
    const concept = resolveConceptForPanel({
      conceptId,
      conceptText,
      conceptName,
      segments: [],
      nPer: 1,
      live: false,
    });

    // Persona is always coerced to a safe spec; usability is judged separately
    // (a body with no persona object yields a defaulted spec, which we treat as
    // "no usable persona" for the no-bill contract).
    // Usable persona = a non-array object that actually carries at least one
    // PersonaSpec field. An empty {} or an array is NOT usable -> no-bill offline.
    const rawPersona = body.persona;
    const hasPersona =
      !!rawPersona &&
      typeof rawPersona === "object" &&
      !Array.isArray(rawPersona) &&
      [
        "age", "region", "household", "dependents", "grossIncome",
        "incomeStability", "liquidAssets", "creditPosture", "notes", "lifeEvents",
      ].some((k) => k in (rawPersona as Record<string, unknown>));
    const persona = parsePersonaSpec(rawPersona);

    const unitName =
      typeof body.unitName === "string" ? body.unitName.trim().slice(0, MAX_UNIT_NAME) : "";

    const seedRaw = (body.seed && typeof body.seed === "object" ? body.seed : {}) as Record<
      string,
      unknown
    >;
    const seed = {
      text: typeof seedRaw.text === "string" ? seedRaw.text.trim().slice(0, MAX_CHAT_MSG) : undefined,
      situation:
        typeof seedRaw.situation === "string"
          ? seedRaw.situation.trim().slice(0, MAX_CHAT_MSG)
          : undefined,
    };

    const messages = parseChatMessages(body.messages);
    const last = messages[messages.length - 1];
    const lastUserMsg = last && last.role === "user" ? last.text : "";

    // No-bill path: missing persona OR the conversation does not end on a
    // non-empty user message (nothing to answer) -> deterministic offline reply.
    if (!hasPersona || !lastUserMsg) {
      res.json({ reply: offlineChatReply(persona, seed, lastUserMsg), mode: "sample" });
      return;
    }

    const ai = getVertexClient();
    if (!ai) {
      res.json({ reply: offlineChatReply(persona, seed, lastUserMsg), mode: "sample" });
      return;
    }

    try {
      const reply = await chatReply(ai, concept, persona, seed, messages);
      res.json({ reply, mode: "live" });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[chat] elicitation failed, returning sample: ${(err as Error).message}`);
      res.json({ reply: offlineChatReply(persona, seed, lastUserMsg), mode: "sample" });
    }
    void unitName; // bounded for observability; identity comes from the persona.
  });

  // POST /api/ask — broadcast one question to the whole panel (synthetic focus
  // group). Body: { conceptId?|conceptText?|conceptName?, segments,
  // customPersonas?, segmentOverrides?, question }. Reuses parsePanelRequest's
  // unit parsing (incl. the fixed empty-segments + customPersonas default and
  // persona caps); units capped to MAX_ASK_UNITS. No-bill contract: blank
  // question OR zero units -> offline replies WITHOUT Vertex. NEVER 5xx.
  router.post("/ask", async (req: Request, res: Response) => {
    const parsed = parsePanelRequest(req.body);
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
      string,
      unknown
    >;
    const question =
      typeof body.question === "string" ? body.question.trim().slice(0, MAX_ASK_QUESTION) : "";

    const concept = resolveConceptForPanel(parsed);
    const units = resolvePanelUnits(parsed).slice(0, MAX_ASK_UNITS);

    // No-bill path: nothing to ask, or no resolved units -> offline replies.
    if (!question || units.length === 0) {
      res.json({
        perUnit: units.map((u) => ({
          unitId: u.id,
          name: u.name,
          color: u.color,
          reply: offlineChatReply(u.persona ?? parsePersonaSpec(undefined), {}, question),
        })),
        mode: "sample",
        fellBack: false,
      });
      return;
    }

    const ai = getVertexClient();

    const settled = await Promise.allSettled(
      units.map((u) => {
        const persona = u.persona ?? parsePersonaSpec(undefined);
        if (!ai) return Promise.reject(new Error("vertex not configured"));
        return askUnitReply(ai, concept, persona, u.name, question);
      })
    );

    let anyLive = false;
    let anyOffline = false;
    const perUnit = units.map((u, i) => {
      const persona = u.persona ?? parsePersonaSpec(undefined);
      const r = settled[i];
      if (r.status === "fulfilled") {
        anyLive = true;
        return { unitId: u.id, name: u.name, color: u.color, reply: r.value };
      }
      anyOffline = true;
      return {
        unitId: u.id,
        name: u.name,
        color: u.color,
        reply: offlineChatReply(persona, {}, question),
      };
    });

    res.json({
      perUnit,
      mode: anyLive ? "live" : "sample",
      fellBack: anyOffline,
    });
  });

  return router;
}

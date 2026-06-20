/* ============================================================
   vertex.ts — Vertex AI client (@google/genai) + persona-reasoning elicitation.

   Auth: Application Default Credentials only (Cloud Run service account).
   NO API keys anywhere. The client is created with vertexai:true.

   elicitReactions() asks Gemini to impersonate N pre-sampled, genuinely
   DISTINCT sub-personas (different incomes/dependents/liquidity/credit), shown
   a concept description. For each person the model FIRST derives their financial
   reality (situation) for THIS product, THEN writes a first-person reaction
   (text) consistent with it, THEN a short driver — all in British English, with
   NO numeric rating. Returns [{ situation?, text, driver }] aligned to persons
   1..N (best effort).
   ============================================================ */

import { GoogleGenAI, Type } from "@google/genai";
import type { Content, Schema } from "@google/genai";
import type { ChatMessage, Concept, PersonaSpec, PersonaVariant, Segment } from "./domain.js";
import { personaToLines } from "./domain.js";

const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENABLE_VERTEX = (process.env.ENABLE_VERTEX || "true").toLowerCase() !== "false";
const VERTEX_TIMEOUT_MS = Math.max(1, Math.floor(numEnv("VERTEX_TIMEOUT_MS", 20000)));

function numEnv(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return dflt;
  const v = Number(raw);
  return Number.isFinite(v) ? v : dflt;
}

/** One model-elicited reaction. `situation` is the derived financial reality. */
export interface PersonaReaction {
  situation?: string;
  text: string;
  driver: string;
}

let client: GoogleGenAI | null = null;

/**
 * Create the Vertex client if enabled and a project is configured.
 * Returns null when Vertex is disabled or no project is set (pure sample mode).
 * Construction itself does not perform network I/O — ADC is resolved lazily.
 */
export function createVertexClient(): GoogleGenAI | null {
  if (!ENABLE_VERTEX) return null;
  if (!VERTEX_PROJECT) return null;
  if (client) return client;
  try {
    client = new GoogleGenAI({
      vertexai: true,
      project: VERTEX_PROJECT,
      location: VERTEX_LOCATION,
    });
    return client;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[vertex] client construction failed: ${(err as Error).message}`);
    client = null;
    return null;
  }
}

export function getVertexClient(): GoogleGenAI | null {
  return client;
}

export const VERTEX_CONFIG = {
  enabled: ENABLE_VERTEX,
  project: VERTEX_PROJECT,
  location: VERTEX_LOCATION,
  geminiModel: GEMINI_MODEL,
  timeoutMs: VERTEX_TIMEOUT_MS,
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * responseSchema: an ARRAY of { situation, text, driver } objects, exactly nPer
 * items, one per sub-persona (aligned to persons 1..N).
 */
function personaSchema(nPer: number): Schema {
  return {
    type: Type.ARRAY,
    minItems: String(nPer),
    maxItems: String(nPer),
    items: {
      type: Type.OBJECT,
      properties: {
        situation: {
          type: Type.STRING,
          description:
            "the respondent's derived financial reality in 1-2 sentences (second-order consequences of their income, dependents, liquidity and credit posture for THIS product, e.g. tax taper + childcare -> tight disposable -> fee-sensitive)",
        },
        text: {
          type: Type.STRING,
          description:
            "First-person reaction in natural British English, 1-3 sentences, consistent with the situation. No numeric rating.",
        },
        driver: {
          type: Type.STRING,
          description: "The key driver of this view, 2-4 words.",
        },
      },
      // `situation` is optional in the contract (coercion tolerates its absence);
      // the prompt still elicits it, but a model that omits it stays valid.
      required: ["text", "driver"],
      propertyOrdering: ["situation", "text", "driver"],
    },
  };
}

/**
 * Build the persona-reasoning prompt: list the N sub-personas NUMBERED 1..N,
 * each via personaToLines(variant) plus its variantLabel, and instruct the model
 * to derive each person's financial reality first, then react, then name a driver.
 */
export function buildPersonaPrompt(
  concept: Concept,
  seg: Segment,
  variants: PersonaVariant[]
): string {
  const nPer = variants.length;
  const people = variants
    .map((v, i) => `  ${i + 1}. ${personaToLines(v)} [${v.variantLabel}]`)
    .join("\n");
  return [
    `You are simulating qualitative consumer research for a UK retail bank.`,
    ``,
    `These ${nPer} people all sit broadly within the segment "${seg.name}", but they`,
    `are GENUINELY DIFFERENT individuals — different incomes, dependents, liquidity`,
    `and credit posture — so their reactions must differ accordingly:`,
    people,
    ``,
    `Show every person this product concept:`,
    `  Product: ${concept.name} (${concept.tag})`,
    `  Description: ${concept.desc}`,
    ``,
    `For EACH person, in order 1..${nPer}, do three things:`,
    `  1. situation — FIRST derive their financial reality for THIS specific product`,
    `     in 1-2 sentences. Reason about second-order effects, e.g. the £100–125k`,
    `     personal-allowance tax taper plus childcare squeezing disposable income;`,
    `     variable or no income making repayments risky; thin savings against a`,
    `     minimum opening deposit; reliance on credit weighed against a fee.`,
    `  2. text — THEN write their first-person reaction to "How likely would you be`,
    `     to apply for / open this?", consistent with the situation you derived.`,
    `  3. driver — THEN a 2-4 word tag naming the single biggest reason behind their`,
    `     view (e.g. "annual fee", "headline rate", "same-day payout", "debt aversion").`,
    ``,
    `Rules for every response:`,
    `- Write in natural, everyday British English, 1 to 3 sentences for the reaction.`,
    `- Because the people genuinely differ, their intent and reasoning must differ:`,
    `  some keen, some lukewarm, some negative — no two voices the same.`,
    `- Be specific to this concept's features AND to that person's finances/life stage.`,
    `- Weigh the concept's ACTUAL figures against each person's finances: a bigger`,
    `  fee, a lower cashback rate, a higher APR, or a minimum deposit they can't meet`,
    `  should lower intent; richer cashback, a higher savings rate, or fee-free terms`,
    `  should raise it. The size of each number matters, not just whether it exists.`,
    `- Do NOT output any numeric rating, score, star or percentage. Words only.`,
    `- Each person must be a distinct voice; do not repeat phrasing.`,
    ``,
    `Return EXACTLY ${nPer} objects in a JSON array, aligned to persons 1..${nPer},`,
    `each { "situation": string, "text": string, "driver": string }.`,
  ].join("\n");
}

/**
 * Parse the model output into PersonaReaction[]. `text` is required (items with
 * an empty text are skipped); `driver` defaults to "general"; `situation` is
 * OPTIONAL — trimmed when present, left undefined when missing. NEVER throws if
 * a situation is absent. Sliced to nPer.
 */
export function coercePersonaReactions(raw: unknown, nPer: number): PersonaReaction[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    parsed = JSON.parse(raw);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("model did not return a JSON array");
  }
  const out: PersonaReaction[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const text = typeof rec.text === "string" ? rec.text.trim() : "";
      if (!text) continue; // skip empty reactions
      const driver = typeof rec.driver === "string" ? rec.driver.trim() : "";
      const situationRaw = typeof rec.situation === "string" ? rec.situation.trim() : "";
      out.push({
        text,
        driver: driver || "general",
        situation: situationRaw || undefined,
      });
    }
  }
  if (out.length === 0) {
    throw new Error("no usable reactions parsed from model output");
  }
  // Best effort: keep up to nPer. A short list is a partial success and the
  // panel orchestrator tops it up with deterministic sample respondents.
  return out.slice(0, nPer);
}

/**
 * Elicit one reaction per pre-sampled sub-persona via a SINGLE Gemini call.
 * Wrapped in a timeout; throws on any failure (caller falls back to sample).
 */
export async function elicitReactions(
  ai: GoogleGenAI,
  concept: Concept,
  seg: Segment,
  variants: PersonaVariant[]
): Promise<PersonaReaction[]> {
  const nPer = variants.length;
  const prompt = buildPersonaPrompt(concept, seg, variants);
  // Abort the request on timeout. Note: @google/genai's abort is client-side —
  // it stops us waiting and signals cancellation, but does not guarantee the
  // server-side call (and its billing) stops; Vertex quotas are the hard cost cap.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VERTEX_TIMEOUT_MS);
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.5,
          topP: 0.9,
          responseMimeType: "application/json",
          responseSchema: personaSchema(nPer),
          // 2.5-flash is a thinking model; disable thinking for fast, low-cost
          // structured elicitation (we want personas, not chain-of-thought).
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: ac.signal,
        },
      }),
      VERTEX_TIMEOUT_MS,
      "generateContent"
    );
    const text = response.text;
    if (!text) {
      throw new Error("empty generateContent response");
    }
    return coercePersonaReactions(text, nPer);
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   Synthetic chat — interview a respondent + ask the panel.

   Both functions GROUND Gemini in the structured persona + concept (and, for an
   interview, the respondent's original reaction) via a systemInstruction, so the
   model stays in character as a single UK consumer. Plain-text replies, no
   numeric rating, British English. Same withTimeout + AbortController pattern as
   elicitReactions. Both THROW on any failure so callers apply the offline
   fallback (routes.ts -> offlineChatReply).
   ============================================================ */

/**
 * Build the grounding systemInstruction that makes Gemini *be* this consumer.
 * `seedText`/`seedSituation` anchor a follow-up interview to the respondent's
 * original verbatim + derived financial reality; for the panel "ask" they are
 * omitted (the unit only has its persona + the concept).
 */
function chatSystemInstruction(
  concept: Concept,
  persona: PersonaSpec,
  seed: { text?: string; situation?: string }
): string {
  const lines = [
    `You ARE this UK consumer: ${personaToLines(persona)}.`,
    `You were shown ${concept.name} (${concept.tag}): ${concept.desc}.`,
  ];
  if (seed.text && seed.text.trim()) {
    const situation = seed.situation && seed.situation.trim() ? ` (your situation: ${seed.situation.trim()})` : "";
    lines.push(`Your initial reaction was '${seed.text.trim()}'${situation}.`);
  } else if (seed.situation && seed.situation.trim()) {
    lines.push(`Your situation: ${seed.situation.trim()}.`);
  }
  lines.push(
    `Stay in character, first person, natural British English, 1-4 sentences, NO numeric rating, consistent with your finances. Answer the researcher's follow-up.`
  );
  return lines.join(" ");
}

/**
 * One conversational turn for an interviewed respondent. The system prompt
 * grounds the model in persona + concept + the original reaction; `messages`
 * (already capped/whitelisted by the caller) become the Gemini `contents` —
 * mapping role user -> "user", persona -> "model". NEVER send "persona" as an
 * SDK role. Returns the model's plain-text reply; throws if empty or on failure.
 */
export async function chatReply(
  ai: GoogleGenAI,
  concept: Concept,
  persona: PersonaSpec,
  seed: { text?: string; situation?: string },
  messages: ChatMessage[]
): Promise<string> {
  const systemInstruction = chatSystemInstruction(concept, persona, seed);
  const contents: Content[] = messages.map((m) => ({
    role: m.role === "persona" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VERTEX_TIMEOUT_MS);
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          temperature: 0.6,
          topP: 0.9,
          responseMimeType: "text/plain",
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: ac.signal,
        },
      }),
      VERTEX_TIMEOUT_MS,
      "chatReply"
    );
    const text = response.text;
    if (!text || !text.trim()) {
      throw new Error("empty chatReply response");
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single-turn in-character answer to a broadcast panel question. Same grounding
 * (persona + concept, no seed reaction) and config as chatReply. `unitName` is
 * supplied for symmetry/observability but the persona itself carries identity.
 * Returns the plain-text reply; throws if empty or on failure.
 */
export async function askUnitReply(
  ai: GoogleGenAI,
  concept: Concept,
  persona: PersonaSpec,
  unitName: string,
  question: string
): Promise<string> {
  const systemInstruction = chatSystemInstruction(concept, persona, {});
  const contents: Content[] = [
    {
      role: "user",
      parts: [
        {
          text: `A researcher asks everyone: "${question}". Answer in character, first person, 1-3 sentences, no numeric rating.`,
        },
      ],
    },
  ];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VERTEX_TIMEOUT_MS);
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          temperature: 0.6,
          topP: 0.9,
          responseMimeType: "text/plain",
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: ac.signal,
        },
      }),
      VERTEX_TIMEOUT_MS,
      "askUnitReply"
    );
    const text = response.text;
    if (!text || !text.trim()) {
      throw new Error("empty askUnitReply response");
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

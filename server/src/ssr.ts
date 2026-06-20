/* ============================================================
   ssr.ts — Semantic Similarity Rating (SSR) via embedding cosine.

   Method after Maier et al. (2025), arXiv:2510.08338:
     - Embed the 5 Likert ANCHORS once at startup and cache them.
     - For a verbatim: embed it, take cosine similarity vs each anchor,
       baseline-subtract (minus the minimum), divide by temperature T,
       softmax -> a probability mass function over the 5 scale points.
     - mean = Σ pmf[i]*(i+1);  applyShare = pmf[3] + pmf[4].

   If anchor embeddings cannot be initialised, the module reports
   ready=false and callers fall back to the lexical ssrProxy in domain.ts.
   ============================================================ */

import { GoogleGenAI } from "@google/genai";
import { ANCHORS, ssrProxy } from "./domain.js";

export interface SsrResult {
  pmf: number[];
  mean: number;
  ssr: "embedding" | "lexical";
}

/** Env-tunable knobs (documented in README / BUILD_SPEC). */
const EMBED_MODEL = process.env.EMBED_MODEL || "gemini-embedding-001";
// Calibrated against gemini-embedding-001: sentence/anchor cosines sit in a
// narrow high band (~0.59–0.73), so a low temperature is required to turn small
// similarity gaps into a discriminating distribution instead of collapsing to ~3.
const SSR_TEMPERATURE = numEnv("SSR_TEMPERATURE", 0.05);
/** Optional epsilon floor added to each pmf entry before renormalising. */
const SSR_EPSILON = numEnv("SSR_EPSILON", 0);
const VERTEX_TIMEOUT_MS = Math.max(1, Math.floor(numEnv("VERTEX_TIMEOUT_MS", 20000)));

function numEnv(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return dflt;
  const v = Number(raw);
  return Number.isFinite(v) ? v : dflt;
}

/* ---------- module state: cached anchor embeddings ---------- */
let anchorVecs: number[][] | null = null;

export function ssrReady(): boolean {
  return anchorVecs !== null;
}

export function ssrMode(): "embedding" | "lexical" {
  return anchorVecs !== null ? "embedding" : "lexical";
}

export function embedModelName(): string {
  return EMBED_MODEL;
}

/* ---------- math helpers ---------- */
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function softmaxOverScale(sims: number[]): { pmf: number[]; mean: number } {
  const min = Math.min(...sims);
  const shifted = sims.map((s) => (s - min) / SSR_TEMPERATURE);
  const max = Math.max(...shifted); // for numerical stability
  const exps = shifted.map((s) => Math.exp(s - max));
  const total = exps.reduce((a, b) => a + b, 0) || 1;
  let pmf = exps.map((e) => e / total);
  if (SSR_EPSILON > 0) {
    pmf = pmf.map((p) => p + SSR_EPSILON);
    const s = pmf.reduce((a, b) => a + b, 0) || 1;
    pmf = pmf.map((p) => p / s);
  }
  const mean = pmf.reduce((acc, p, i) => acc + p * (i + 1), 0);
  return { pmf, mean };
}

/** Map a precomputed similarity vector (length 5) to an SSR pmf. */
export function pmfFromSims(sims: number[]): { pmf: number[]; mean: number } {
  return softmaxOverScale(sims);
}

/* ---------- embedding I/O ---------- */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Embed ONE input per request.
 *
 * DELIBERATE DECISION (reviewed 2026-06-16): we do NOT multi-input batch.
 *  - gemini-embedding-001 on Vertex accepts only ONE input text per request, so
 *    passing an array would 400 and (via the catch in callers) silently degrade
 *    the run to lexical SSR — dropping the demo's headline embedding feature.
 *  - Even if it batched, there is ~no win here: embeddings bill per input TOKEN
 *    (not per request), and these calls already run concurrently (Promise.all in
 *    embedTexts), so both $ and wall-clock are effectively unchanged.
 * Each text therefore gets its own call; order is preserved by Promise.all.
 * Any failure rejects -> caller falls back to the lexical ssrProxy.
 */
async function embedOne(ai: GoogleGenAI, text: string, signal: AbortSignal): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { abortSignal: signal },
  });
  const v = res.embeddings?.[0]?.values;
  if (!v || v.length === 0) {
    throw new Error("empty embedding");
  }
  return v;
}

async function embedTexts(ai: GoogleGenAI, texts: string[]): Promise<number[][]> {
  // One AbortController + timer for the whole batch; aborts all on timeout.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VERTEX_TIMEOUT_MS);
  try {
    return await withTimeout(
      Promise.all(texts.map((t) => embedOne(ai, t, ac.signal))),
      VERTEX_TIMEOUT_MS,
      "embedContent"
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed the 5 ANCHORS once and cache. Returns true on success.
 * On any failure the cache stays null and the caller treats SSR as lexical.
 */
export async function initAnchors(ai: GoogleGenAI): Promise<boolean> {
  try {
    const vecs = await embedTexts(ai, ANCHORS);
    if (vecs.length !== ANCHORS.length) {
      throw new Error("anchor embedding count mismatch");
    }
    anchorVecs = vecs;
    return true;
  } catch (err) {
    anchorVecs = null;
    // eslint-disable-next-line no-console
    console.warn(
      `[ssr] anchor embedding init failed; falling back to lexical SSR: ${
        (err as Error).message
      }`
    );
    return false;
  }
}

/** Reset cached anchors (used to force lexical mode). */
export function disableEmbeddingSsr(): void {
  anchorVecs = null;
}

/**
 * Map a single free-text verbatim to a Likert pmf.
 * Uses embedding cosine vs anchors when available; otherwise ssrProxy.
 */
export async function ssrText(ai: GoogleGenAI | null, text: string): Promise<SsrResult> {
  if (ai && anchorVecs) {
    try {
      const [v] = await embedTexts(ai, [text]);
      const sims = anchorVecs.map((a) => cosine(v, a));
      const { pmf, mean } = softmaxOverScale(sims);
      return { pmf, mean, ssr: "embedding" };
    } catch {
      // fall through to lexical
    }
  }
  const { pmf, mean } = ssrProxy(text);
  return { pmf, mean, ssr: "lexical" };
}

/**
 * Batch-map many verbatims to pmfs in a single embedding call.
 * Returns one result per input, in order. Falls back to lexical on failure.
 */
export async function ssrTextsBatch(ai: GoogleGenAI | null, texts: string[]): Promise<SsrResult[]> {
  if (ai && anchorVecs && texts.length > 0) {
    try {
      const vecs = await embedTexts(ai, texts);
      return vecs.map((v) => {
        const sims = anchorVecs!.map((a) => cosine(v, a));
        const { pmf, mean } = softmaxOverScale(sims);
        return { pmf, mean, ssr: "embedding" as const };
      });
    } catch {
      // fall through to lexical
    }
  }
  return texts.map((t) => {
    const { pmf, mean } = ssrProxy(t);
    return { pmf, mean, ssr: "lexical" as const };
  });
}

export const SSR_CONFIG = {
  embedModel: EMBED_MODEL,
  temperature: SSR_TEMPERATURE,
  epsilon: SSR_EPSILON,
  timeoutMs: VERTEX_TIMEOUT_MS,
};

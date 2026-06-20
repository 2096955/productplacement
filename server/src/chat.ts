/* ============================================================
   chat.ts — deterministic, in-character OFFLINE fallback for synthetic chat.

   When Vertex is unavailable (no client, timeout, throw, rate-limit) OR a
   request would not bill anyway (no usable persona, no trailing user message,
   blank question), the /api/chat and /api/ask handlers return one of these
   canned, in-character lines INSTEAD of calling Gemini. No network I/O.

   The line is derived from the persona (income/credit posture) + the seed
   reaction/situation, stays first person, British English, carries NO numeric
   rating, and ends with a subtle note that a live reply needs Vertex — so the
   demo never shows a blank chat bubble and never silently fakes a live model.
   ============================================================ */

import type { PersonaSpec } from "./domain.js";

/** £-format mirroring domain.ts money() so the line reads consistently. */
function money(n: number): string {
  return n >= 1000 ? `£${Math.round(n / 1000)}k` : `£${Math.round(n)}`;
}

/** A short, human read on this persona's credit posture for the canned line. */
function postureLean(persona: PersonaSpec): string {
  switch (persona.creditPosture) {
    case "averse":
      return "I'm cautious about credit and watch every fee";
    case "reliant":
      return "I do lean on credit when I need to";
    default:
      return "I'm fairly mainstream about credit";
  }
}

/** Restate the respondent's leaning from their seed reaction, if we have one. */
function leaningFromSeed(seed: { text?: string; situation?: string }): string {
  const t = (seed.text || "").toLowerCase();
  if (!t.trim()) return "I'd want to weigh it against my own finances";
  if (/(definitely|sign me up|i'?d apply|i'?d open|absolutely|no[- ]brainer)/.test(t)) {
    return "as I said, it does appeal to me";
  }
  if (/(not for me|wouldn'?t|would not|no chance|give this a miss|can'?t justify|dealbreaker)/.test(t)) {
    return "as I said, it's not really for me";
  }
  if (/(might|maybe|depends|on the fence|not sure|do the sums|small print|tempted)/.test(t)) {
    return "I'm still on the fence about it, like I said";
  }
  return "my view hasn't really shifted from what I said";
}

/**
 * Deterministic in-character reply for a single follow-up or panel question.
 * `lastUserMsg` (the researcher's most recent question) is acknowledged when
 * present. NEVER calls Vertex; NEVER throws.
 */
export function offlineChatReply(
  persona: PersonaSpec,
  seed: { text?: string; situation?: string },
  lastUserMsg?: string
): string {
  const incomePosture = `On ${money(persona.grossIncome)} a year with ${money(persona.liquidAssets)} put by, ${postureLean(persona)}`;
  const leaning = leaningFromSeed(seed);
  const q = (lastUserMsg || "").trim();
  const ack = q ? "Good question — " : "";
  const note = " (Live, in-character chat needs Vertex; this is a sample reply.)";
  return `${ack}${incomePosture}. Honestly, ${leaning}, so I'd need it to clearly suit my situation before I committed.${note}`;
}

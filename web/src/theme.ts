/* ============================================================
   theme.ts — HSBC-inspired theme tokens for the demo (web only).
   Independent demonstration. NOT affiliated with or endorsed by HSBC.
   HSBC red (#DB0011) used illustratively for a conference context.
   ============================================================ */

export const BRAND = {
  red: "#DB0011", // HSBC red
  redDark: "#A50010",
  ink: "#1C1C1C", // near-black
  paper: "#F3F4F4",
  white: "#FFFFFF",
  line: "#E2E5E6",
  muted: "#6B7578",
  field: "#FAFBFB",
};

// Backwards-compatible aliases used throughout the ported component.
export const INK = BRAND.ink;
export const MUTED = BRAND.muted;
export const LINE = BRAND.line;
export const PAPER = BRAND.paper;
export const ACCENT = BRAND.red; // primary action colour

/* Diverging 5-point Likert scale, anchored on HSBC red for the
   "definitely not" end through to a positive teal-green for "definitely". */
export const LIKERT_COLORS = [
  "#DB0011", // 1 — strong negative (HSBC red)
  "#E0683E", // 2 — negative
  "#C9A227", // 3 — neutral / unsure
  "#4E8F6B", // 4 — positive
  "#0E7C72", // 5 — strong positive
];

export const FONT_SANS = "'Hanken Grotesk', system-ui, -apple-system, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";

export const DISCLAIMER =
  "Independent technical demonstration. Not affiliated with, endorsed by, or representing HSBC Holdings plc; 'HSBC' and the hexagon device are trademarks of their respective owner, used here illustratively only. Personas and responses are synthetic — no customer data is used. Indicative only — not FCA Consumer Duty outcomes testing. Method after Maier et al. (2025), arXiv:2510.08338.";

export const BRAND_NAME = "HSBC";
export const PRODUCT_NAME = "Concept Lab";
export const PRODUCT_KICKER = "SYNTHETIC CONSUMER PANEL · UK RETAIL";

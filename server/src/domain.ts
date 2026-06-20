/* ============================================================
   domain.ts — canonical data + offline SSR/sample logic + Persona Studio.
   Framework-agnostic (no node/browser/React imports).
   CANONICAL COPY: server/src/domain.ts. Copied BYTE-IDENTICAL to
   web/src/domain.ts (diff is a build gate). Do not let them diverge.
   ============================================================ */

export type Pmf = number[]; // length 5, sums to ~1

/* ---------- Persona Studio types ---------- */
export type Household = "single" | "couple" | "family";
export type IncomeStability = "stable" | "variable" | "none" | "windfall";
export type CreditPosture = "averse" | "mainstream" | "reliant";

export interface PersonaSpec {
  age: number; // 18..90
  region: string;
  household: Household;
  dependents: number; // 0..8
  grossIncome: number; // £ gross annual (household-level per `household`)
  incomeStability: IncomeStability;
  liquidAssets: number; // £ accessible savings/cash
  creditPosture: CreditPosture;
  lifeEvents: string[];
  notes: string;
}

export interface PersonaVariant extends PersonaSpec {
  variantLabel: string; // short tag e.g. "stretched", "comfortable", "asset-rich, low-income"
}

export interface CustomPersona {
  id: string; // server-assigned, e.g. "__byop_0__"
  name: string;
  color: string;
  spec: PersonaSpec;
}

export interface Concept {
  id: string;
  name: string;
  tag: string;
  desc: string;
  appeals: [string, string][]; // [spoken phrase, short driver tag]
  objections: [string, string][];
  base: Record<string, number>; // segId -> base purchase intent (1..5); legacy fallback only
}

export interface Segment {
  id: string;
  name: string;
  brief: string;
  color: string;
  persona?: PersonaSpec; // structured persona (archetypes carry one; legacy segments may omit)
}

export interface RespondentResult {
  text: string;
  driver: string;
  situation?: string; // derived "financial reality" (Persona Studio); optional for legacy/fallback
  pmf: number[];
  mean: number;
}

export interface SegmentResult {
  responses: RespondentResult[];
  pmf: number[];
  mean: number;
  applyShare: number;
}

export interface PanelRequest {
  conceptId?: string;
  conceptText?: string; // for a custom/BYO concept
  conceptName?: string;
  segments: string[]; // segment ids (catalogue)
  nPer: number; // respondents per segment
  live: boolean; // true => attempt Vertex elicitation
  seed?: number; // optional, for repeatable runs
  customPersonas?: CustomPersona[]; // ad-hoc BYO personas (run as extra units)
  segmentOverrides?: Record<string, Partial<PersonaSpec>>; // light-edit of an archetype's persona
}

export interface PanelResponse {
  mode: "live" | "sample";
  fellBack: boolean; // live requested but Vertex unavailable
  perSegment: Record<string, SegmentResult>; // keyed by unit id (segment or custom persona)
  meta: {
    model?: string;
    embedModel?: string;
    ssr: "embedding" | "lexical";
    note?: string;
    ms?: number;
    personaReasoning?: boolean; // any live unit produced a model-written `situation`
    units?: Array<{ id: string; name: string; color: string }>; // resolved units, so the UI can render BYO too
  };
}

/** One turn in a synthetic-chat conversation. `persona` maps to the Gemini
 *  `model` role at request time — never send "persona" as an SDK role. */
export interface ChatMessage {
  role: "user" | "persona";
  text: string;
}

/* ---------- Likert anchors (one statement per scale point) ---------- */
export const ANCHORS = [
  "I would definitely not apply for this product.",
  "It's unlikely I'd take this — it doesn't suit me.",
  "I'm not sure. I might consider it with more information.",
  "I would probably apply for this product.",
  "I'd definitely apply as soon as it's available.",
];

/* ---------- Concepts (UK retail banking) ---------- */
export const CONCEPTS: Concept[] = [
  {
    id: "card",
    name: "Aurora Cashback Card",
    tag: "Credit card",
    desc:
      "2% cashback on all spend. £95 annual fee. No foreign exchange fees abroad. Section 75 purchase protection. Apple Pay & Google Pay from day one.",
    appeals: [
      ["2% back on everything", "flat cashback"],
      ["no fees when I'm abroad", "FX-free spend"],
      ["the Section 75 protection", "Section 75"],
    ],
    objections: [
      ["the £95 annual fee", "annual fee"],
      ["needing to spend a lot just to break even", "break-even maths"],
      ["another credit check on my file", "credit check"],
    ],
    base: { GENZ: 2.3, YPRO: 3.9, FAM: 3.1, AFFL: 4.0, SQZ: 1.9 },
  },
  {
    id: "saver",
    name: "Boost Saver",
    tag: "Easy-access savings",
    desc:
      "4.6% AER variable, easy access. App-only account. £500 minimum opening deposit. FSCS protected up to £85,000. Interest paid monthly.",
    appeals: [
      ["4.6% with easy access", "headline rate"],
      ["the FSCS protection on my money", "FSCS cover"],
      ["moving money out whenever I like", "easy access"],
    ],
    objections: [
      ["the £500 minimum to open", "£500 minimum"],
      ["it being app-only", "app-only"],
      ["the rate quietly dropping after a few months", "rate drop risk"],
    ],
    base: { GENZ: 3.4, YPRO: 4.3, FAM: 3.8, AFFL: 3.9, SQZ: 2.6 },
  },
  {
    id: "loan",
    name: "FlexPay Personal Loan",
    tag: "Personal loan",
    desc:
      "6.9% APR representative on £7,500–£15,000 over 1–5 years. Same-day payout once approved. No early repayment charge. Soft-search eligibility check.",
    appeals: [
      ["same-day payout", "same-day payout"],
      ["no early repayment charge", "no ERC"],
      ["a clear fixed monthly cost", "fixed cost"],
    ],
    objections: [
      ["6.9% being only 'representative' — I'd likely be quoted more", "representative APR"],
      ["taking on more debt right now", "debt aversion"],
      ["the hard credit check at application", "credit check"],
    ],
    base: { GENZ: 2.8, YPRO: 3.3, FAM: 3.9, AFFL: 2.4, SQZ: 3.0 },
  },
];

export const CUSTOM_BASE: Record<string, number> = {
  GENZ: 3.1,
  YPRO: 3.3,
  FAM: 3.2,
  AFFL: 3.2,
  SQZ: 2.9,
};

/* ---------- Segments (archetypes — editable starting points, each with a structured persona) ---------- */
export const SEGMENTS: Segment[] = [
  {
    id: "GENZ",
    name: "Gen Z renter",
    brief: "22, £24k, Manchester, renting, student loan, app-first",
    color: "#6B4FA0",
    persona: { age: 22, region: "Manchester", household: "single", dependents: 0, grossIncome: 24000, incomeStability: "stable", liquidAssets: 800, creditPosture: "mainstream", lifeEvents: ["renting", "student loan"], notes: "app-first, thin savings" },
  },
  {
    id: "YPRO",
    name: "Young professional",
    brief: "29, £48k, London, saving for a deposit, rate-aware",
    color: "#1D6FB8",
    persona: { age: 29, region: "London", household: "single", dependents: 0, grossIncome: 48000, incomeStability: "stable", liquidAssets: 18000, creditPosture: "mainstream", lifeEvents: ["saving for a deposit"], notes: "rate-aware" },
  },
  {
    id: "FAM",
    name: "Family mainstream",
    brief: "41, £38k household, West Midlands, mortgage, two kids",
    color: "#C4663A",
    persona: { age: 41, region: "West Midlands", household: "family", dependents: 2, grossIncome: 38000, incomeStability: "stable", liquidAssets: 3000, creditPosture: "mainstream", lifeEvents: ["mortgage", "two children"], notes: "household income, childcare costs" },
  },
  {
    id: "AFFL",
    name: "Mass affluent 55+",
    brief: "58, £85k, South East, homeowner, ISA-savvy",
    color: "#B5179E",
    persona: { age: 58, region: "South East", household: "couple", dependents: 0, grossIncome: 85000, incomeStability: "stable", liquidAssets: 60000, creditPosture: "averse", lifeEvents: ["homeowner"], notes: "ISA-savvy, fee-conscious" },
  },
  {
    id: "SQZ",
    name: "Squeezed budget",
    brief: "35, £19k, North East, credit-cautious, fee-averse",
    color: "#C8102E",
    persona: { age: 35, region: "North East", household: "single", dependents: 1, grossIncome: 19000, incomeStability: "variable", liquidAssets: 300, creditPosture: "averse", lifeEvents: ["budgeting"], notes: "credit-cautious, fee-averse" },
  },
];

export function conceptById(id?: string): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id);
}
export function segmentById(id: string): Segment | undefined {
  return SEGMENTS.find((s) => s.id === id);
}

/* ---------- Likert pmf helpers ---------- */
export function gaussianPmf(center: number, sigma: number): { pmf: number[]; mean: number } {
  const raw = [1, 2, 3, 4, 5].map(
    (r) => Math.exp(-((r - center) ** 2) / (2 * sigma * sigma)) + 0.015
  );
  const s = raw.reduce((a, b) => a + b, 0);
  const pmf = raw.map((v) => v / s);
  const mean = pmf.reduce((a, p, i) => a + p * (i + 1), 0);
  return { pmf, mean };
}

export function aggregate(responses: RespondentResult[]): { pmf: number[]; mean: number; applyShare: number } {
  const pmf = [0, 0, 0, 0, 0];
  responses.forEach((r) => r.pmf.forEach((p, i) => (pmf[i] += p)));
  const s = pmf.reduce((a, b) => a + b, 0) || 1;
  const norm = pmf.map((p) => p / s);
  const mean = norm.reduce((a, p, i) => a + p * (i + 1), 0);
  return { pmf: norm, mean, applyShare: norm[3] + norm[4] };
}

/* ============================================================
   SSR lexical proxy (offline fallback for the embedding SSR).
   Demo-grade stand-in for embedding cosine similarity vs anchors.
   The PRODUCTION path uses gemini-embedding-001 cosine (server/ssr.ts).
   ============================================================ */
const STRONG_NEG = ["definitely not", "wouldn't", "would not", "no chance", "not for me", "give this a miss", "avoid", "rip-off", "rip off", "can't justify", "cannot justify", "waste of"];
const NEG = ["puts me off", "off-putting", "kills it", "too expensive", "steep", "sceptical", "skeptical", "worried", "concern", "stick with what i", "don't need", "do not need", "unlikely", "not worth", "money's tight", "money is tight"];
const HEDGE = ["might", "maybe", "depends", "on the fence", "consider", "not sure", "need more", "do the sums", "small print", "tempted by", "if "];
const POS = ["appealing", "decent", "good rate", "great", "tempting", "like the", "useful", "worth it", "competitive", "handy", "suits how", "nothing obvious putting me off"];
const STRONG_POS = ["definitely", "sign me up", "straight away", "i'd open this", "id open this", "i'd apply", "would apply", "no-brainer", "no brainer", "absolutely", "switch"];

export function ssrProxy(text: string): { pmf: number[]; mean: number } {
  const t = (text || "").toLowerCase();
  const hits = (arr: string[]) => arr.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  let delta =
    -1.3 * Math.min(hits(STRONG_NEG), 2) -
    0.7 * Math.min(hits(NEG), 3) +
    0.7 * Math.min(hits(POS), 3) +
    1.3 * Math.min(hits(STRONG_POS), 2);
  delta = Math.max(-2, Math.min(2, delta));
  let score = 3 + delta;
  const hedged = hits(HEDGE) > 0;
  if (hedged) score = score + (3 - score) * 0.3;
  return gaussianPmf(score, hedged ? 0.9 : 0.65);
}

/* ============================================================
   Deterministic seeded RNG (repeatable on stage).
   ============================================================ */
export interface Rng {
  rnd: () => number;
  gauss: () => number;
}
export function makeRng(seed: number): Rng {
  let s = (Math.floor(seed) % 2147483647 + 2147483647) % 2147483647 || 7;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  return { rnd, gauss };
}

function cap(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ============================================================
   Persona Studio — heterogeneity sampler, concept signals,
   and a transparent deterministic intent scorer.
   Pure functions: (seed, spec, concept) fully determine output, so live
   and offline use the SAME people for a given seed.
   ============================================================ */

const money = (n: number): string => (n >= 1000 ? `£${Math.round(n / 1000)}k` : `£${Math.round(n)}`);

/** Compact human summary of a persona — shared by the Gemini prompt and the UI. */
export function personaToLines(s: PersonaSpec): string {
  const dep = s.dependents > 0 ? `${s.dependents} dependent${s.dependents > 1 ? "s" : ""}` : "no dependents";
  const ev = s.lifeEvents.length ? `; ${s.lifeEvents.join(", ")}` : "";
  const notes = s.notes ? `; ${s.notes}` : "";
  return `${s.age}, ${s.region}, ${s.household}, ${dep}; gross ${money(s.grossIncome)}/yr (${s.incomeStability} income); ~${money(s.liquidAssets)} liquid; ${s.creditPosture} on credit${ev}${notes}`;
}

/** Very rough annual disposable-income proxy (after a crude tax + living estimate). */
function disposableProxy(s: PersonaSpec): number {
  let net = s.grossIncome;
  // UK 60% effective marginal band between £100k–£125,140 (personal-allowance taper).
  if (s.grossIncome > 100000) net -= Math.min(s.grossIncome - 100000, 25140) * 0.6;
  net = net * 0.7; // crude after basic tax/NI
  const living = 12000 + s.dependents * 9000 + (s.household === "family" ? 6000 : s.household === "couple" ? 3000 : 0);
  return Math.round(net - living);
}

function variantLabelFor(s: PersonaSpec): string {
  if (s.incomeStability === "none") return "no income";
  if (s.incomeStability === "windfall" || (s.liquidAssets > 200000 && s.grossIncome < 25000)) return "asset-rich, low-income";
  const disp = disposableProxy(s);
  if (disp < 6000) return "stretched";
  if (disp > 30000 && s.liquidAssets > 30000) return "comfortable";
  return "borderline";
}

/** Expand one archetype spec into N DISTINCT, seeded sub-personas (incl. borderline).
 *  Distinctness is guaranteed even for flat/zero base specs: each candidate's key
 *  signature is checked, re-rolled a few times, then deterministically perturbed. */
export function samplePersonaVariants(base: PersonaSpec, n: number, rng: Rng): PersonaVariant[] {
  const out: PersonaVariant[] = [];
  const seen = new Set<string>();
  // Signature matches the situation-VISIBLE axes (income/liquid rounded to £k as
  // money() displays them, plus dependents/credit/income-stability) so that two
  // distinct variants also render two distinct rationales — age is NOT shown in
  // a situation, so it must not count toward uniqueness.
  const sig = (s: PersonaSpec) =>
    `${Math.round(s.grossIncome / 1000)}|${Math.round(s.liquidAssets / 1000)}|${s.dependents}|${s.creditPosture}|${s.incomeStability}`;
  const draw = (): PersonaSpec => {
    // Honour the authored CATEGORICAL fields (dependents, household, income
    // stability, credit posture): only the continuous axes vary. This still
    // yields genuinely different people (income/liquidity/age drive most of the
    // financial-reality reasoning) without contradicting what the user typed —
    // e.g. a "reliant, 0 dependents" persona never renders as "mainstream, 1 dependent".
    const grossIncome = Math.max(0, Math.round((base.grossIncome * (0.6 + rng.rnd() * 0.9)) / 100) * 100);
    const liquidAssets = Math.max(0, Math.round((base.liquidAssets * (0.2 + rng.rnd() * 2.8)) / 100) * 100);
    const age = Math.max(18, Math.min(90, base.age + Math.round((rng.rnd() - 0.5) * 16)));
    return { ...base, age, grossIncome, liquidAssets };
  };
  for (let i = 0; i < n; i++) {
    let spec = draw();
    for (let attempt = 0; attempt < 5 && seen.has(sig(spec)); attempt++) spec = draw();
    // Guarantee a distinct VISIBLE signature, even for flat/zero base specs:
    // nudge gross income by £1k (one display step) until the signature is fresh.
    let guard = 0;
    while (seen.has(sig(spec)) && guard++ < 80) {
      spec = { ...spec, grossIncome: spec.grossIncome + 1000 };
    }
    seen.add(sig(spec));
    out.push({ ...spec, variantLabel: variantLabelFor(spec) });
  }
  return out;
}

export interface ConceptSignals {
  hasFee: boolean;
  isCredit: boolean;
  isSavings: boolean;
  headlineRate?: number;
  minDeposit?: number;
  feeAmount?: number; // annualised £ fee, when a figure is stated
  cashbackPct?: number; // cashback percentage, when stated
}

export function conceptSignals(c: Concept): ConceptSignals {
  const t = `${c.tag} ${c.desc}`.toLowerCase();
  const feeFree = /no\s+(annual|monthly)\s+fee|fee-free|fee free/.test(t);
  const hasFee = /(annual|monthly)\s+fee|£\s?\d[\d,]*\s*(annual|monthly)?\s*fee|\bfee\s+of\s+£/.test(t) && !feeFree;
  const isCredit = /credit card|\bloan\b|\bapr\b|borrow|repayment/.test(t);
  const isSavings = /saver|savings|\baer\b|deposit|interest paid|easy access/.test(t);
  const rateM = t.match(/(\d+(?:\.\d+)?)\s*%\s*(aer|apr)/);
  const headlineRate = rateM ? Number(rateM[1]) : undefined;
  const depM = t.match(/£\s?([\d,]+)\s*(minimum|min)/);
  const minDeposit = depM ? Number(depM[1].replace(/,/g, "")) : undefined;

  // Fee amount — only when a fee actually applies. Matches "£95 annual fee" or
  // "fee of £95"; annualises a stated monthly fee.
  let feeAmount: number | undefined;
  if (hasFee) {
    // Prefer "£95 … fee" (£ before fee). Fallback only matches the explicit
    // "fee of £95" form, so a later unrelated £ (e.g. a minimum deposit) in the
    // same sentence is never mistaken for the fee.
    const fm =
      t.match(/£\s?([\d,]+)(?:\.\d+)?\s*(?:annual|monthly|yearly|a\s+year|per\s+year|p\.?a\.?)?\s*fee/) ||
      t.match(/\bfee\s+of\s+£\s?([\d,]+)/);
    if (fm) {
      let amt = Number(fm[1].replace(/,/g, ""));
      const monthlyFee = /monthly\s+fee|£\s?[\d,]+(?:\.\d+)?\s*(?:per|a|\/)\s*month/.test(t);
      if (monthlyFee && amt > 0 && amt < 600) amt *= 12;
      if (Number.isFinite(amt) && amt > 0) feeAmount = amt;
    }
  }

  // Cashback percentage, e.g. "2% cashback".
  const cbM = t.match(/(\d+(?:\.\d+)?)\s*%\s*cash\s?back/) || t.match(/cash\s?back[^.%]*?(\d+(?:\.\d+)?)\s*%/);
  const cashbackPct = cbM ? Number(cbM[1]) : undefined;

  return { hasFee, isCredit, isSavings, headlineRate, minDeposit, feeAmount, cashbackPct };
}

// Baselines for rate sensitivity, anchored to the catalogue's own numbers so the
// three built-in concepts stay near-neutral on the rate term and only BYO
// deviations swing intent.
const AER_BASELINE = 4.6; // Boost Saver headline AER
const APR_BASELINE = 6.9; // FlexPay representative APR

/** Transparent 1..5 purchase-intent + human rationale from PersonaSpec × concept.
 *  Magnitude-aware: fee size (vs. disposable income), cashback %, and AER/APR rate
 *  all move the score, not just their presence — so editing the product's numbers
 *  changes the result. Pure + deterministic; the head stays income-bearing so the
 *  per-respondent de-dupe in sampleRespondentsFromVariants still varies per £1k. */
export function heuristicIntent(s: PersonaSpec, sig: ConceptSignals): { intent: number; rationale: string } {
  let intent = 3.0;
  const reasons: string[] = [];
  const disp = disposableProxy(s);
  const tight = disp < 9000;
  const taper = s.grossIncome > 100000 && s.grossIncome <= 125140 && s.dependents > 0;

  if (sig.hasFee) {
    if (sig.feeAmount != null) {
      // Graded by fee size relative to affordability: a bigger fee, and/or a
      // tighter budget, hurts more. Boolean fallback below when no £ is stated.
      const burden = sig.feeAmount / Math.max(disp, 3000);
      let penalty = 0.25 + 14 * Math.min(burden, 0.25);
      if (s.creditPosture === "averse" || tight) penalty += 0.5;
      penalty = Math.min(penalty, 2.2);
      intent -= penalty;
      reasons.push(`the ${money(sig.feeAmount)} fee is about ${Math.round(burden * 100)}% of yearly disposable income`);
    } else if (s.creditPosture === "averse" || tight) {
      intent -= 1.1;
      reasons.push("the fee is hard to justify on a tight monthly budget");
    } else {
      intent -= 0.3;
    }
  }
  if (sig.cashbackPct != null) {
    intent += Math.min(1.3, sig.cashbackPct * 0.18);
    reasons.push(`${sig.cashbackPct}% cashback ${sig.cashbackPct >= 4 ? "is genuinely rewarding" : "sweetens it a little"}`);
  }
  if (sig.isSavings) {
    if (sig.minDeposit != null && s.liquidAssets < sig.minDeposit) {
      intent -= 1.0;
      reasons.push(`falls under the ${money(sig.minDeposit)} minimum to open`);
    } else if (s.liquidAssets > (sig.minDeposit ?? 0)) {
      intent += 0.6;
      reasons.push("has cash to put to work at the headline rate");
    }
    if (sig.headlineRate != null) {
      const d = sig.headlineRate - AER_BASELINE;
      intent += Math.max(-0.8, Math.min(0.9, d * 0.3));
      if (Math.abs(d) >= 0.5) reasons.push(`${sig.headlineRate}% AER ${d > 0 ? "beats" : "trails"} the going rate`);
    }
    if (s.incomeStability === "variable" || s.incomeStability === "none") {
      intent += 0.3;
      reasons.push("values easy access given uneven income");
    }
  }
  if (sig.isCredit) {
    if (s.creditPosture === "reliant") {
      intent += 0.4;
      reasons.push("leans on available credit");
      if (sig.hasFee) intent -= 0.3;
    }
    if (s.creditPosture === "averse") {
      intent -= 0.7;
      reasons.push("wary of taking on more credit");
    }
    if (sig.headlineRate != null) {
      const d = sig.headlineRate - APR_BASELINE;
      intent -= Math.max(-0.4, Math.min(0.9, d * 0.06));
      if (d >= 1) reasons.push(`${sig.headlineRate}% APR is steep`);
    }
    if (s.incomeStability === "none" || s.incomeStability === "windfall") {
      intent -= 0.6;
      reasons.push("no regular income to service borrowing");
    }
  }
  if (s.incomeStability === "windfall" && s.liquidAssets > 100000) {
    reasons.push("cash-rich from a windfall but income-light");
  }
  if (taper) {
    intent -= 0.4;
    reasons.push("high on paper, but the £100–125k tax taper plus childcare leaves disposable income tight");
  }

  intent = Math.max(1, Math.min(5, intent));
  const depWord = s.dependents === 0 ? "no dependents" : s.dependents === 1 ? "1 dependent" : `${s.dependents} dependents`;
  const head = `${money(s.grossIncome)} gross, ${depWord}, ${money(s.liquidAssets)} liquid, ${s.creditPosture} on credit`;
  const rationale = reasons.length ? `${head} → ${reasons.join("; ")}.` : `${head} → broadly neutral fit for this product.`;
  return { intent, rationale };
}

/* ============================================================
   Deterministic STAGE-SAFETY FALLBACK (offline) verbatim generator.
   Persona-aware when a spec exists; legacy base-anchored otherwise.
   ============================================================ */
type Tpl = (objection: string, appeal: string) => string;
const TPL: Record<"low" | "mid" | "high", Tpl[]> = {
  low: [
    (o) => `${cap(o)} — that puts me off straight away. Not for me.`,
    (o) => `Honestly, ${o} kills it for me. I'd give this a miss.`,
    (o) => `I can't justify it. ${cap(o)}, and money's tight enough as it is.`,
    (o) => `No thanks — ${o} is a dealbreaker for me.`,
    (o) => `I'd steer clear. ${cap(o)} just isn't worth it on my budget.`,
    (o) => `Not a chance. ${cap(o)}, so I'll stick with what I've got.`,
  ],
  mid: [
    (o, a) => `I'm on the fence. ${cap(a)} is decent, but ${o}.`,
    (o) => `Maybe. I'd want to read the small print — ${o} worries me a bit.`,
    (o, a) => `Tempted by ${a}, though ${o}. I'd need to do the sums first.`,
    (o, a) => `Could go either way — ${a} appeals, but ${o} gives me pause.`,
    (o, a) => `Possibly. ${cap(a)} is a plus, yet ${o} holds me back.`,
    (o) => `Not sure it's for me. ${cap(o)} — I'd have to think it over.`,
  ],
  high: [
    (_o, a) => `${cap(a)} is genuinely appealing — I'd probably apply.`,
    (_o, a) => `This looks worth it. ${cap(a)}, and nothing obvious putting me off.`,
    (_o, a) => `I'd open this. ${cap(a)} suits how I manage my money.`,
    (_o, a) => `Yes, I'm interested — ${a} is exactly what I've been after.`,
    (_o, a) => `Sign me up. ${cap(a)} makes this an easy yes for me.`,
    (_o, a) => `Definitely tempted. ${cap(a)} would fit my finances nicely.`,
  ],
};

function bandFor(s: number): "low" | "mid" | "high" {
  return s < 2.5 ? "low" : s < 3.6 ? "mid" : "high";
}

/** Build one offline respondent from an intent score (+ optional derived situation). */
function respondentFromScore(concept: Concept, score: number, rng: Rng, situation?: string): RespondentResult {
  const s = Math.max(1, Math.min(5, score));
  const band = bandFor(s);
  const obj = concept.objections[Math.floor(rng.rnd() * concept.objections.length)];
  const app = concept.appeals[Math.floor(rng.rnd() * concept.appeals.length)];
  const text = TPL[band][Math.floor(rng.rnd() * TPL[band].length)](obj[0], app[0]);
  const driver = band === "high" ? app[1] : obj[1];
  const { pmf, mean } = gaussianPmf(s, band === "mid" ? 0.85 : 0.6);
  return { text, driver, situation, pmf, mean };
}

/** Persona-aware offline respondents from pre-sampled variants (carry `situation`).
 *  De-dupes on the ACTUAL rendered situation string (concept-dependent) — the only
 *  signature that guarantees visibly-distinct rationales — nudging gross income by
 *  £1k (a display step that changes the situation head) until each is unique.
 *  Deterministic: the perturbation consumes no rng, so seeded runs stay repeatable. */
export function sampleRespondentsFromVariants(concept: Concept, variants: PersonaVariant[], rng: Rng): RespondentResult[] {
  const sig = conceptSignals(concept);
  const seenSituations = new Set<string>();
  return variants.map((v) => {
    let spec: PersonaSpec = v;
    let { intent, rationale } = heuristicIntent(spec, sig);
    let guard = 0;
    while (seenSituations.has(rationale) && guard++ < 80) {
      spec = { ...spec, grossIncome: spec.grossIncome + 1000 };
      ({ intent, rationale } = heuristicIntent(spec, sig));
    }
    seenSituations.add(rationale);
    return respondentFromScore(concept, intent + rng.gauss() * 0.35, rng, rationale);
  });
}

/** Offline respondents for one unit. Persona-aware when a spec exists; legacy base path otherwise. */
export function sampleSegment(concept: Concept, seg: Segment, n: number, rng: Rng): RespondentResult[] {
  if (seg.persona) {
    return sampleRespondentsFromVariants(concept, samplePersonaVariants(seg.persona, n, rng), rng);
  }
  // Legacy fallback: base-anchored, no situation (kept for back-compat / specless segments).
  const base = concept.base?.[seg.id] ?? 3.2;
  const out: RespondentResult[] = [];
  for (let i = 0; i < n; i++) {
    out.push(respondentFromScore(concept, base + rng.gauss() * 0.55, rng));
  }
  return out;
}

/* ============================================================
   Unit resolution — catalogue segments (+ overrides) plus BYO personas.
   Shared by the live orchestrator (server/panel.ts) and the offline path.
   ============================================================ */
/** Concept-appropriate appeals/objections for a BYO concept, derived from its
 *  text + parsed signals — so verbatims and the UI theme cards reference the REAL
 *  product (its fee, cashback, rate, minimum) instead of reusing the catalogue
 *  card's phrases. Always returns >= 2 of each so theme mining never empties. */
export function deriveByoThemes(
  desc: string,
  sig: ConceptSignals
): { appeals: [string, string][]; objections: [string, string][] } {
  const d = desc.toLowerCase();
  const appeals: [string, string][] = [];
  const objections: [string, string][] = [];

  if (sig.cashbackPct != null) appeals.push([`the ${sig.cashbackPct}% cashback`, "cashback"]);
  if (sig.isSavings && sig.headlineRate != null) appeals.push([`the ${sig.headlineRate}% rate`, "headline rate"]);
  if (/fx|foreign|abroad|overseas|travel/.test(d)) appeals.push(["no fees when I'm abroad", "FX-free spend"]);
  if (/protection|protected|section\s*75|fscs|insured|cover/.test(d)) appeals.push(["the protection it comes with", "protection"]);
  appeals.push(["the overall package", "value"]);

  if (sig.feeAmount != null) objections.push([`the ${money(sig.feeAmount)} fee`, "annual fee"]);
  else if (sig.hasFee) objections.push(["the fee", "annual fee"]);
  if (sig.minDeposit != null) objections.push([`the ${money(sig.minDeposit)} minimum to open`, "minimum deposit"]);
  if (sig.isCredit) objections.push(["another credit check on my file", "credit check"]);
  if (sig.isSavings) objections.push(["the rate quietly dropping later", "rate drop risk"]);
  objections.push(["whether it really fits how I manage money", "fit"]);

  // Guarantee >= 2 of each so verbatim generation + theme mining never thin out.
  if (appeals.length < 2) appeals.push(["how well it fits everyday spending", "everyday fit"]);
  if (objections.length < 2) objections.push(["whether the perks really pay off for me", "payoff"]);

  return { appeals: appeals.slice(0, 4), objections: objections.slice(0, 4) };
}

export function resolveConceptForPanel(req: PanelRequest): Concept {
  const found = conceptById(req.conceptId);
  if (found) return found;
  const desc = req.conceptText || "";
  const sig = conceptSignals({ id: "custom", name: "", tag: "Your concept", desc, appeals: [], objections: [], base: {} });
  const { appeals, objections } = deriveByoThemes(desc, sig);
  return {
    id: "custom",
    name: req.conceptName || "Custom concept",
    tag: "Your concept",
    desc,
    appeals,
    objections,
    base: CUSTOM_BASE,
  };
}

/** Ordered working units: catalogue segments (with overrides applied) then BYO personas. */
export function resolvePanelUnits(req: PanelRequest): Segment[] {
  const units: Segment[] = [];
  (req.segments || []).forEach((id) => {
    const seg = segmentById(id);
    if (!seg) return;
    const ov = req.segmentOverrides?.[id];
    const persona = seg.persona ? { ...seg.persona, ...(ov || {}) } : undefined;
    units.push({ ...seg, persona });
  });
  (req.customPersonas || []).forEach((cp) => {
    units.push({ id: cp.id, name: cp.name, color: cp.color, brief: personaToLines(cp.spec), persona: cp.spec });
  });
  return units;
}

/** A full offline panel run (the universal "stage-safety fallback"). */
export function samplePanel(req: PanelRequest): PanelResponse {
  const concept = resolveConceptForPanel(req);
  const baseSeed = req.seed ?? 7;
  const units = resolvePanelUnits(req);
  const perSegment: Record<string, SegmentResult> = {};
  units.forEach((seg, idx) => {
    const rng = makeRng(baseSeed + idx * 1000 + seg.id.length);
    const responses = sampleSegment(concept, seg, req.nPer, rng);
    perSegment[seg.id] = { responses, ...aggregate(responses) };
  });
  return {
    mode: "sample",
    fellBack: false,
    perSegment,
    meta: { ssr: "lexical", units: units.map((u) => ({ id: u.id, name: u.name, color: u.color })) },
  };
}

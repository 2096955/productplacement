/* ============================================================
   PROTOTYPE_REFERENCE.jsx — the original conference prototype.
   FOR LAYOUT REFERENCE ONLY when porting to src/App.tsx (TS + HSBC theme + API).
   The `saver.appeals` syntax bug from the original paste is FIXED here.
   When porting: source CONCEPTS/SEGMENTS/ANCHORS + sample/SSR logic from
   src/domain.ts, and colours/tokens from src/theme.ts — do NOT re-declare them.
   Replace the client-side Anthropic fetch with POST /api/panel (+ local samplePanel fallback).
   ============================================================ */
import React, { useState, useMemo } from "react";

const LIKERT_COLORS = ["#8E2A35", "#C4663A", "#D9A441", "#4E8F6B", "#0E7C72"];
const INK = "#11252F";
const MUTED = "#5C7079";
const LINE = "#DCE5E7";
const PAPER = "#F4F7F7";
const TEAL = "#0E7C72";

const ANCHORS = [
  "I would definitely not apply for this product.",
  "It's unlikely I'd take this — it doesn't suit me.",
  "I'm not sure. I might consider it with more information.",
  "I would probably apply for this product.",
  "I'd definitely apply as soon as it's available.",
];

const CONCEPTS = [
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

const SEGMENTS = [
  { id: "GENZ", name: "Gen Z renter", brief: "22, £24k, Manchester, renting, student loan, app-first", color: "#6B4FA0" },
  { id: "YPRO", name: "Young professional", brief: "29, £48k, London, saving for a deposit, rate-aware", color: "#0E7C72" },
  { id: "FAM", name: "Family mainstream", brief: "41, £38k household, West Midlands, mortgage, two kids", color: "#C4663A" },
  { id: "AFFL", name: "Mass affluent 55+", brief: "58, £85k, South East, homeowner, ISA-savvy", color: "#11252F" },
  { id: "SQZ", name: "Squeezed budget", brief: "35, £19k, North East, credit-cautious, fee-averse", color: "#8E2A35" },
];

/* NOTE: the original also defined ssrProxy/gaussianPmf/sample generator/liveSegment/aggregate
   and the UI atoms PmfBars, PmfStrip, Spectrum, Kpi, ThemeCard, Card, plus the App() with
   Panel/Method/Deploy tabs. Reproduce that SAME layout in src/App.tsx, but:
     - import data + sample + ssrProxy + aggregate + samplePanel from "@/domain"
     - import colours/tokens from "@/theme"
     - replace liveSegment()'s browser call to api.anthropic.com with POST /api/panel,
       and on failure call samplePanel(req) locally (never die on stage)
     - apply HSBC theme (red hexagon header, ACCENT buttons, DISCLAIMER footer)
   See the original message / BUILD_SPEC.md for the full tab copy (Method + Deploy). */

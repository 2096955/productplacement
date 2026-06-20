/* ============================================================
   visuals.tsx — small presentational atoms for the Concept Lab.
   Likert pmf bars, per-respondent pmf strips, the Likert spectrum,
   KPI tiles, theme cards and a generic surface Card.
   Colours come from theme.ts; data shapes come from domain.ts.
   ============================================================ */
import React from "react";
import { LIKERT_COLORS, INK, MUTED, LINE, ACCENT } from "@/theme";
import { ANCHORS } from "@/domain";

const LIKERT_SHORT = ["Definitely not", "Unlikely", "Unsure", "Probably", "Definitely"];

/* ---------- Surface card ---------- */
export function Card({
  children,
  className = "",
  as: As = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <As
      className={`rounded-xl bg-white ${className}`}
      style={{
        border: `1px solid ${LINE}`,
        boxShadow: "0 1px 2px rgba(28,28,28,0.04), 0 12px 32px -20px rgba(28,28,28,0.20)",
      }}
    >
      {children}
    </As>
  );
}

/* ---------- Full Likert pmf, as horizontal stacked bar + legend ---------- */
export function PmfBars({
  pmf,
  height = 22,
  showScale = true,
}: {
  pmf: number[];
  height?: number;
  showScale?: boolean;
}) {
  const total = pmf.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <div
        className="flex w-full overflow-hidden rounded-md"
        style={{ height, border: `1px solid ${LINE}` }}
        role="img"
        aria-label={`Likelihood distribution: ${pmf
          .map((p, i) => `${LIKERT_SHORT[i]} ${Math.round((p / total) * 100)}%`)
          .join(", ")}`}
      >
        {pmf.map((p, i) => {
          const pct = (p / total) * 100;
          return (
            <div
              key={i}
              style={{
                width: `${pct}%`,
                background: LIKERT_COLORS[i],
                transition: "width 240ms ease",
              }}
              title={`${LIKERT_SHORT[i]}: ${pct.toFixed(0)}%`}
            />
          );
        })}
      </div>
      {showScale && (
        <div className="mt-1 flex justify-between" style={{ fontSize: 10, color: MUTED }}>
          {LIKERT_SHORT.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block rounded-sm"
                style={{ width: 8, height: 8, background: LIKERT_COLORS[i] }}
              />
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Compact per-respondent pmf strip (no legend) ---------- */
export function PmfStrip({ pmf }: { pmf: number[] }) {
  const total = pmf.reduce((a, b) => a + b, 0) || 1;
  return (
    <div
      className="flex overflow-hidden rounded"
      style={{ height: 8, width: 120, border: `1px solid ${LINE}` }}
      role="img"
      aria-label={`Distribution: ${pmf
        .map((p, i) => `${LIKERT_SHORT[i]} ${Math.round((p / total) * 100)}%`)
        .join(", ")}`}
    >
      {pmf.map((p, i) => (
        <div
          key={i}
          style={{ width: `${(p / total) * 100}%`, background: LIKERT_COLORS[i] }}
          title={`${LIKERT_SHORT[i]}: ${((p / total) * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  );
}

/* ---------- The five-point Likert spectrum with anchors ---------- */
export function Spectrum() {
  return (
    <div>
      {/* minmax(0, 1fr) lets the five cells shrink below their content's min-width
          so the row never forces horizontal overflow on a narrow (~340px) column. */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {ANCHORS.map((a, i) => (
          <div
            key={i}
            className="rounded-lg p-2"
            style={{ background: "#fff", border: `1px solid ${LINE}`, minWidth: 0 }}
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="flex shrink-0 items-center justify-center rounded-full text-white"
                style={{
                  width: 20,
                  height: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  background: LIKERT_COLORS[i],
                }}
              >
                {i + 1}
              </span>
              <span
                style={{ fontSize: 10, fontWeight: 600, color: INK, overflowWrap: "anywhere" }}
              >
                {LIKERT_SHORT[i]}
              </span>
            </div>
            <p style={{ fontSize: 11, lineHeight: 1.35, color: MUTED, overflowWrap: "anywhere" }}>
              {a}
            </p>
          </div>
        ))}
      </div>
      <div
        className="mt-2 h-1.5 w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${LIKERT_COLORS.join(", ")})`,
        }}
        aria-hidden
      />
    </div>
  );
}

/* ---------- KPI tile ---------- */
export function Kpi({
  label,
  value,
  sub,
  accent = false,
  mono = true,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  /** Monospace numerics by default; pass false for proper-noun values (segment names). */
  mono?: boolean;
}) {
  return (
    <Card className="flex h-full flex-col p-4">
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: MUTED }}>
        {label.toUpperCase()}
      </div>
      <div
        className="mt-1 font-display"
        style={{
          fontSize: mono ? 32 : 20,
          fontWeight: 600,
          color: accent ? ACCENT : INK,
          lineHeight: 1.1,
          wordBreak: "break-word",
          fontVariantNumeric: "lining-nums tabular-nums",
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-auto pt-1" style={{ fontSize: 12, color: MUTED }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

/* ---------- Theme card: a clustered objection/appeal with count ---------- */
export function ThemeCard({
  kind,
  label,
  count,
  share,
}: {
  kind: "objection" | "appeal";
  label: string;
  count: number;
  share: number;
}) {
  const positive = kind === "appeal";
  const tint = positive ? "#0E7C72" : ACCENT;
  return (
    <div
      className="flex items-center justify-between rounded-lg px-3 py-2"
      style={{ background: positive ? "#F0F7F5" : "#FCEFF0", border: `1px solid ${LINE}` }}
    >
      <div className="min-w-0">
        <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: MUTED }}>
          {count} {count === 1 ? "mention" : "mentions"} · {Math.round(share * 100)}% of panel
        </div>
      </div>
      <span
        className="ml-3 shrink-0 rounded-full px-2 py-0.5 text-white"
        style={{ fontSize: 11, fontWeight: 700, background: tint }}
      >
        {positive ? "Appeal" : "Objection"}
      </span>
    </div>
  );
}

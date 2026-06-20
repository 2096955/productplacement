/* ============================================================
   MethodTab.tsx — explains the SSR method, with a live "try it" box.
   Copy is taken verbatim from the build brief (British English).
   ============================================================ */
import React, { useState } from "react";
import { Card, PmfBars } from "@/components/visuals";
import { INK, MUTED, LINE, ACCENT, LIKERT_COLORS } from "@/theme";
import { ANCHORS, ssrProxy } from "@/domain";

interface SsrResult {
  pmf: number[];
  mean: number;
  ssr: "embedding" | "lexical";
}

const SECTION_TITLE: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: INK };
const BODY: React.CSSProperties = { fontSize: 14, lineHeight: 1.6, color: MUTED };

export function MethodTab() {
  const [text, setText] = useState(
    "Honestly the £95 fee puts me off — I'd have to spend a fortune just to break even. I'll stick with my fee-free card."
  );
  const [result, setResult] = useState<SsrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);

  async function runLive() {
    setBusy(true);
    setUsedFallback(false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch("/api/ssr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SsrResult;
      setResult(data);
      if (data.ssr === "lexical") setUsedFallback(true);
    } catch {
      // Never die on stage — map locally with the lexical proxy.
      const { pmf, mean } = ssrProxy(text);
      setResult({ pmf, mean, ssr: "lexical" });
      setUsedFallback(true);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* 1 */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>Why not just ask the LLM for a 1–5 rating?</h3>
        <p className="mt-2" style={BODY}>
          Direct Likert elicitation collapses to the safe middle of the scale. In the source study
          (Maier et al., 2025 — 57 surveys, 9,300 human respondents), direct ratings managed
          distributional similarity of only 0.26 against real panels. The model nearly always
          answered “3”.
        </p>
      </Card>

      {/* 2 */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>What SSR does instead</h3>
        <p className="mt-2" style={BODY}>
          The synthetic consumer answers in free text, in character. That text is embedded and
          compared by cosine similarity against five anchor statements — one per Likert point —
          producing a probability distribution over the scale rather than a forced single number.
          Result: distributional similarity ~0.88 and ~90% of human test–retest reliability, with
          rich qualitative reasons as a by-product.
        </p>
      </Card>

      {/* 2b — Persona Studio reasoning step */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>How Persona Studio reasons before it reacts</h3>
        <p className="mt-2" style={BODY}>
          Each structured persona is first expanded into several distinct, seeded sub-personas, so a
          single archetype becomes a small spread of believable individuals rather than one
          stereotype. Before any of them reacts, the model derives that sub-persona's financial
          reality — the second-order effects an LLM would otherwise skip, such as the £100–125k tax
          taper combined with childcare squeezing a high headline salary, or being asset-rich yet
          income-light. Only then does the sub-persona respond in free text, and that reaction is
          mapped to a full Likert distribution through SSR. The derived reasoning is shown alongside
          each verbatim so you can see why a respondent landed where they did.
        </p>
      </Card>

      {/* Try it live */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h3 style={SECTION_TITLE}>Try it live</h3>
          <span style={{ fontSize: 12, color: MUTED }}>
            Free text → Likert distribution via SSR
          </span>
        </div>
        <p className="mt-1" style={{ ...BODY, fontSize: 13 }}>
          Type how a customer might react, then map it to a probability distribution over the scale.
        </p>
        <label htmlFor="ssr-input" className="sr-only">
          Free-text customer reaction
        </label>
        <textarea
          id="ssr-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mt-3 w-full resize-y rounded-lg px-3 py-2"
          style={{ border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FAFBFB" }}
          placeholder="e.g. The rate's great but I'm not keen on it being app-only…"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={runLive}
            disabled={busy || !text.trim()}
            className="rounded-lg px-4 py-2 font-semibold text-white transition disabled:opacity-50"
            style={{ background: ACCENT, fontSize: 14 }}
          >
            {busy ? "Mapping…" : "Map to distribution"}
          </button>
          {result && (
            <span className="font-mono" style={{ fontSize: 13, color: INK }}>
              Mean PI {result.mean.toFixed(2)}
              <span style={{ color: MUTED }}>
                {" "}
                · {result.ssr === "embedding" ? "embedding cosine" : "lexical proxy"}
              </span>
            </span>
          )}
        </div>
        {usedFallback && (
          <div className="mt-2" style={{ fontSize: 12, color: ACCENT }}>
            Mapped with the offline lexical proxy (embedding SSR unavailable).
          </div>
        )}
        {result && (
          <div className="mt-4">
            <PmfBars pmf={result.pmf} height={26} />
          </div>
        )}
      </Card>

      {/* 3 — the five anchors */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>The five anchors used here</h3>
        <ol className="mt-3 grid gap-2">
          {ANCHORS.map((a, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex shrink-0 items-center justify-center rounded-full text-white"
                style={{
                  width: 22,
                  height: 22,
                  fontSize: 12,
                  fontWeight: 700,
                  background: LIKERT_COLORS[i],
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 14, color: INK }}>{a}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* 4 */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>Demo-grade vs production-grade mapping</h3>
        <p className="mt-2" style={BODY}>
          This build uses true embedding cosine SSR (gemini-embedding-001 on Vertex AI) when
          credentials are present, and a transparent lexical proxy as an offline fallback so the demo
          runs anywhere. Anchor sets can be tuned per question type (“likelihood to open”,
          “likelihood to switch”, “trust in the brand”).
        </p>
      </Card>

      {/* 5 — honest limits (amber/warn) */}
      <Card className="p-5" >
        <div className="rounded-lg p-4" style={{ background: "#FBF4E7", border: "1px solid #E8D7A8" }}>
          <h3 style={{ ...SECTION_TITLE, color: "#8A6A12" }}>
            Honest limits — and the upsell inside them
          </h3>
          <p className="mt-2" style={{ ...BODY, color: "#6F5A1E" }}>
            Synthetic panels under-represent gender, region and ethnicity effects, and validity
            weakens on niche products with thin training-data coverage. Position: synthetic screening
            for the long list, human panels for the shortlist and protected segments, plus an
            SSR-vs-human calibration run as a paid validation phase. Synthetic research is not a
            substitute for FCA Consumer Duty outcomes testing.
          </p>
        </div>
      </Card>
    </div>
  );
}

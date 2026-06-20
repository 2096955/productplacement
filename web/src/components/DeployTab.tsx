/* ============================================================
   DeployTab.tsx — production architecture, agent swarm and demo script.
   Copy is taken verbatim from the build brief (British English).
   ============================================================ */
import React from "react";
import { Card } from "@/components/visuals";
import { INK, MUTED, LINE, ACCENT } from "@/theme";

const SECTION_TITLE: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: INK };
const ITEM: React.CSSProperties = { fontSize: 14, lineHeight: 1.55, color: MUTED };

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 grid gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2" style={ITEM}>
          <span
            aria-hidden
            className="mt-2 inline-block shrink-0 rounded-full"
            style={{ width: 6, height: 6, background: ACCENT }}
          />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function DeployTab() {
  return (
    <div className="grid gap-4">
      {/* A — Production architecture */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>Production architecture (GCP)</h3>
        <Bullets
          items={[
            <>
              <strong>Elicitation:</strong> Vertex AI · Gemini Flash, batched persona prompts,
              temperature ~0.5.
            </>,
            <>
              <strong>SSR mapping:</strong> gemini-embedding-001 cosine vs anchor sets; temperature
              tuning per question type.
            </>,
            <>
              <strong>Orchestration:</strong> this app is a single Cloud Run service; scale to Cloud
              Run jobs + Pub/Sub fan-out per segment for large surveys; results to BigQuery.
            </>,
            <>
              <strong>Dashboard:</strong> this demo runs as a single public Cloud Run service; in
              production it can sit behind IAP, or be embedded in Salesforce via a Lightning Web
              Component.
            </>,
            <>
              <strong>Governance:</strong> VPC-SC perimeter, CMEK, no client PII in prompts —
              personas are synthetic composites only.
            </>,
          ]}
        />
      </Card>

      {/* B — Agent swarm */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>Agent swarm decomposition</h3>
        <Bullets
          items={[
            <>
              <strong>Orchestrator</strong> — survey spec → fan-out, retries, aggregation.
            </>,
            <>
              <strong>Persona agent</strong> — segment libraries from the bank’s own anonymised
              segmentation.
            </>,
            <>
              <strong>Elicitation agent</strong> — runs synthetic interviews, enforces the
              no-numeric-rating rule.
            </>,
            <>
              <strong>SSR mapper</strong> — embeddings, anchor calibration, pmf construction.
            </>,
            <>
              <strong>Theme miner</strong> — clusters verbatims into objections/appeals with evidence
              quotes.
            </>,
            <>
              <strong>Validator</strong> — correlation attainment vs any human benchmark wave; drift
              alerts.
            </>,
          ]}
        />
      </Card>

      {/* C — Demo script */}
      <Card className="p-5">
        <h3 style={SECTION_TITLE}>Conference demo script (4 minutes)</h3>
        <ol className="mt-3 grid gap-3">
          {[
            <>
              Run the cashback card across all five segments — watch “Squeezed budget” reject the £95
              fee live.
            </>,
            <>
              Open the verbatims: point at a specific objection (“break-even maths”) a Likert score
              alone would never surface.
            </>,
            <>
              Switch to Boost Saver — same personas, opposite ranking. Segmentation signal, not noise.
            </>,
            <>
              Close: “50 concepts screened in a week, human panels reserved for the top five. Shall we
              calibrate against your last survey wave?”
            </>,
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="flex shrink-0 items-center justify-center rounded-full text-white"
                style={{ width: 24, height: 24, fontSize: 13, fontWeight: 700, background: ACCENT }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.55, color: INK }}>{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div
        className="rounded-lg p-3 text-center"
        style={{ border: `1px dashed ${LINE}`, fontSize: 12, color: MUTED }}
      >
        Single Cloud Run service · Vertex AI Gemini Flash + gemini-embedding-001 · Application Default
        Credentials only — no API keys in the client or repo.
      </div>
    </div>
  );
}

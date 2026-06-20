/* ============================================================
   App.tsx — HSBC SSR Concept Lab. Three tabs: Panel / Method / Deploy.
   Ported from PROTOTYPE_REFERENCE.jsx into TypeScript, re-themed to HSBC
   via theme.ts. Data + logic imported from domain.ts; never re-declared.

   Data flow: optionally GET /api/config on load, POST /api/panel to run,
   and POST /api/ssr (Method tab) — all with a robust local fallback to
   samplePanel / ssrProxy so the UI never dies on stage.

   Persona Studio: catalogue archetypes can be light-edited inline
   (segmentOverrides) and up to three bring-your-own personas can be
   authored and run as extra units. Results render from
   response.meta.units so BYO personas appear alongside the catalogue.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import {
  CONCEPTS,
  SEGMENTS,
  conceptById,
  resolveConceptForPanel,
  samplePanel,
  type Concept,
  type Segment,
  type PanelRequest,
  type PanelResponse,
  type SegmentResult,
  type PersonaSpec,
  type CustomPersona,
} from "@/domain";
import { InterviewDrawer } from "@/components/InterviewDrawer";
import {
  INK,
  MUTED,
  LINE,
  PAPER,
  ACCENT,
  DISCLAIMER,
  BRAND_NAME,
  PRODUCT_NAME,
  PRODUCT_KICKER,
} from "@/theme";
import { Hexagon } from "@/components/Hexagon";
import { Card, PmfBars, PmfStrip, Spectrum, Kpi, ThemeCard } from "@/components/visuals";
import { PersonaForm } from "@/components/PersonaForm";
import { MethodTab } from "@/components/MethodTab";
import { DeployTab } from "@/components/DeployTab";

type TabId = "panel" | "method" | "deploy";
const TABS: { id: TabId; label: string }[] = [
  { id: "panel", label: "Panel" },
  { id: "method", label: "Method" },
  { id: "deploy", label: "Deploy" },
];

const BYO = "__byo__";

/* ---------- BYO persona palette + sensible default spec ---------- */
const BYO_PALETTE = ["#0E7C72", "#7A5195", "#EF8C00"];
const MAX_CUSTOM = 3;

/** A deliberately borderline starting point — invites editing rather than a stereotype. */
function defaultPersonaSpec(): PersonaSpec {
  return {
    age: 34,
    region: "Leeds",
    household: "couple",
    dependents: 1,
    grossIncome: 32000,
    incomeStability: "variable",
    liquidAssets: 1500,
    creditPosture: "mainstream",
    lifeEvents: ["new job"],
    notes: "borderline budget; reviewing options carefully",
  };
}

/* ---------- compact one-line persona summary for the collapsed segment card ----------
   Reflects inline edits (income/region/credit/etc.) without the multi-line verbosity
   of personaToLines, which made the controls column too tall. */
function fmtK(n: number): string {
  return n >= 1000 ? `£${Math.round(n / 1000)}k` : `£${Math.round(n)}`;
}
function conciseSummary(p: PersonaSpec): string {
  const dep = p.dependents > 0 ? `${p.dependents} dep${p.dependents > 1 ? "s" : ""}` : "no deps";
  return `${p.age} · ${p.region} · ${fmtK(p.grossIncome)} · ${dep} · ${p.creditPosture} credit`;
}

/* ---------- config (server or local fallback) ---------- */
interface AppConfig {
  concepts: Concept[];
  segments: Segment[];
}

/* ---------- a resolved run unit (segment or custom persona) ---------- */
interface Unit {
  id: string;
  name: string;
  color: string;
}

/* ---------- an open 1:1 interview (drives the InterviewDrawer) ---------- */
interface ActiveInterview {
  conversationKey: string;
  unit: Unit;
  persona: PersonaSpec;
  seed: { text?: string; situation?: string };
}

/* ---------- one unit's reply to an "ask the panel" broadcast ---------- */
interface AskResult {
  unitId: string;
  name: string;
  color: string;
  reply: string;
}

/* ---------- aggregate panel-level summary from a PanelResponse ---------- */
interface ThemeStat {
  label: string;
  count: number;
  share: number;
}
interface PanelSummary {
  overallPmf: number[];
  meanPI: number;
  applyShare: number;
  ranking: { unit: Unit; res: SegmentResult }[];
  topObjections: ThemeStat[];
  topAppeals: ThemeStat[];
  nRespondents: number;
}

/**
 * Resolve the list of units to render results for. Prefers the server's
 * meta.units (so BYO personas always appear); falls back to the local
 * config segments + custom personas if meta.units is missing.
 */
function resolveUnits(
  resp: PanelResponse,
  segments: Segment[],
  customPersonas: CustomPersona[]
): Unit[] {
  if (resp.meta?.units && resp.meta.units.length) {
    return resp.meta.units.map((u) => ({ id: u.id, name: u.name, color: u.color }));
  }
  // Fallback: any present perSegment key, matched to a known segment/persona.
  const known = new Map<string, Unit>();
  segments.forEach((s) => known.set(s.id, { id: s.id, name: s.name, color: s.color }));
  customPersonas.forEach((c) => known.set(c.id, { id: c.id, name: c.name, color: c.color }));
  return Object.keys(resp.perSegment).map(
    (id) => known.get(id) ?? { id, name: id, color: MUTED }
  );
}

function summarise(
  resp: PanelResponse,
  concept: Concept,
  units: Unit[]
): PanelSummary {
  const overall = [0, 0, 0, 0, 0];
  let n = 0;
  const ranking: { unit: Unit; res: SegmentResult }[] = [];

  units.forEach((unit) => {
    const r = resp.perSegment[unit.id];
    if (!r) return;
    ranking.push({ unit, res: r });
    r.responses.forEach((resp1) => {
      resp1.pmf.forEach((p, i) => (overall[i] += p));
      n += 1;
    });
  });

  const total = overall.reduce((a, b) => a + b, 0) || 1;
  const overallPmf = overall.map((p) => p / total);
  const meanPI = overallPmf.reduce((a, p, i) => a + p * (i + 1), 0);
  const applyShare = overallPmf[3] + overallPmf[4];

  ranking.sort((a, b) => b.res.mean - a.res.mean);

  // Theme mining: count driver tags across responses, split by appeal/objection.
  const objLabels = new Set(concept.objections.map((o) => o[1]));
  const appLabels = new Set(concept.appeals.map((a) => a[1]));
  const objCount = new Map<string, number>();
  const appCount = new Map<string, number>();

  units.forEach((unit) => {
    const r = resp.perSegment[unit.id];
    if (!r) return;
    r.responses.forEach((resp1) => {
      const d = resp1.driver;
      if (appLabels.has(d)) appCount.set(d, (appCount.get(d) ?? 0) + 1);
      else if (objLabels.has(d)) objCount.set(d, (objCount.get(d) ?? 0) + 1);
      else {
        // Unknown driver tag (e.g. from a custom concept): treat by sentiment.
        if (resp1.mean >= 3.5) appCount.set(d, (appCount.get(d) ?? 0) + 1);
        else objCount.set(d, (objCount.get(d) ?? 0) + 1);
      }
    });
  });

  const toStats = (m: Map<string, number>): ThemeStat[] =>
    [...m.entries()]
      .map(([label, count]) => ({ label, count, share: n ? count / n : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

  return {
    overallPmf,
    meanPI,
    applyShare,
    ranking,
    topObjections: toStats(objCount),
    topAppeals: toStats(appCount),
    nRespondents: n,
  };
}

export default function App() {
  const [tab, setTab] = useState<TabId>("panel");
  const [config, setConfig] = useState<AppConfig>({ concepts: CONCEPTS, segments: SEGMENTS });

  /* ----- Panel controls ----- */
  const [conceptId, setConceptId] = useState<string>(CONCEPTS[0].id);
  const [byoName, setByoName] = useState("My new concept");
  const [byoText, setByoText] = useState(
    "A fee-free everyday account with round-up saving and 1% cashback on direct debits, paid monthly."
  );
  const [selectedSegs, setSelectedSegs] = useState<string[]>(SEGMENTS.map((s) => s.id));
  const [nPer, setNPer] = useState(6);
  const [live, setLive] = useState(false);

  /* ----- Persona Studio state ----- */
  // Light edits to a catalogue archetype's persona (only non-empty ones are sent).
  const [segmentOverrides, setSegmentOverrides] = useState<Record<string, Partial<PersonaSpec>>>({});
  // Bring-your-own personas; each is selectable + removable (max 3).
  const [customPersonas, setCustomPersonas] = useState<CustomPersona[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<PanelResponse | null>(null);
  const [activeConcept, setActiveConcept] = useState<Concept | null>(null);
  // Snapshot of the PanelRequest used for the displayed run, so "Ask the panel"
  // queries the SAME panel even if the controls are edited after the run.
  const [activeRequest, setActiveRequest] = useState<PanelRequest | null>(null);
  // Snapshot of the custom personas used in the last run (for results fallback).
  const [activeCustom, setActiveCustom] = useState<CustomPersona[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  /* ----- Synthetic Chat state ----- */
  // Bumped on each run so a conversation key is unique to a run (a respondent has
  // no stable id; we key on runSeq + unitId + verbatim index).
  const [runSeq, setRunSeq] = useState(0);
  // Persona AS RUN for each resolved unit — the interview must use the persona the
  // request used, NOT live segmentOverrides edited afterwards.
  const [activeUnitPersonas, setActiveUnitPersonas] = useState<Record<string, PersonaSpec>>({});
  // The currently-open 1:1 interview (null = drawer closed).
  const [activeInterview, setActiveInterview] = useState<ActiveInterview | null>(null);
  // Ask-the-panel: one broadcast question → a reply per unit.
  const [askQuestion, setAskQuestion] = useState("");
  const [askResults, setAskResults] = useState<AskResult[] | null>(null);
  const [askLoading, setAskLoading] = useState(false);

  /* ----- Optional /api/config on load (fall back to local domain.ts) ----- */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    (async () => {
      try {
        const res = await fetch("/api/config", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Partial<AppConfig>;
        if (
          !cancelled &&
          Array.isArray(data.concepts) &&
          data.concepts.length &&
          Array.isArray(data.segments) &&
          data.segments.length
        ) {
          setConfig({ concepts: data.concepts, segments: data.segments });
        }
      } catch {
        // Local fallback already in place.
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const concepts = config.concepts;
  const segments = config.segments;

  function toggleSeg(id: string) {
    setSelectedSegs((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  /* ----- Segment persona override helpers ----- */
  // The override-merged persona shown in a segment's inline editor.
  function mergedPersona(seg: Segment): PersonaSpec | undefined {
    if (!seg.persona) return undefined;
    return { ...seg.persona, ...(segmentOverrides[seg.id] ?? {}) };
  }
  function hasOverride(segId: string): boolean {
    const ov = segmentOverrides[segId];
    return !!ov && Object.keys(ov).length > 0;
  }
  // Write the full edited spec into overrides as a diff against the base persona.
  function setSegmentPersona(seg: Segment, next: PersonaSpec) {
    if (!seg.persona) return;
    const base = seg.persona;
    const diff: Partial<PersonaSpec> = {};
    (Object.keys(next) as (keyof PersonaSpec)[]).forEach((k) => {
      if (!shallowEqual(next[k], base[k])) {
        // @ts-expect-error — key/value types align by construction.
        diff[k] = next[k];
      }
    });
    setSegmentOverrides((prev) => {
      const copy = { ...prev };
      if (Object.keys(diff).length) copy[seg.id] = diff;
      else delete copy[seg.id];
      return copy;
    });
  }
  function resetSegmentPersona(segId: string) {
    setSegmentOverrides((prev) => {
      const copy = { ...prev };
      delete copy[segId];
      return copy;
    });
  }

  /* ----- Custom persona helpers (cap 3) ----- */
  function addCustomPersona() {
    setCustomPersonas((prev) => {
      if (prev.length >= MAX_CUSTOM) return prev;
      const idx = prev.length;
      const id = `__byop_${idx}__`;
      const persona: CustomPersona = {
        id,
        name: `Custom persona ${idx + 1}`,
        color: BYO_PALETTE[idx % BYO_PALETTE.length],
        spec: defaultPersonaSpec(),
      };
      setSelectedCustom((sel) => (sel.includes(id) ? sel : [...sel, id]));
      return [...prev, persona];
    });
  }
  function updateCustomPersona(id: string, patch: Partial<CustomPersona>) {
    setCustomPersonas((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function updateCustomSpec(id: string, spec: PersonaSpec) {
    updateCustomPersona(id, { spec });
  }
  function removeCustomPersona(id: string) {
    // Drop the persona, then re-key the remaining ones so ids stay __byop_0..n__.
    setCustomPersonas((prev) => {
      const kept = prev.filter((c) => c.id !== id);
      const selSet = new Set(selectedCustom);
      const reindexed: CustomPersona[] = [];
      const nextSel: string[] = [];
      kept.forEach((c, idx) => {
        const newId = `__byop_${idx}__`;
        const wasSelected = selSet.has(c.id);
        reindexed.push({ ...c, id: newId, color: BYO_PALETTE[idx % BYO_PALETTE.length] });
        if (wasSelected) nextSel.push(newId);
      });
      setSelectedCustom(nextSel);
      return reindexed;
    });
  }
  function toggleCustom(id: string) {
    setSelectedCustom((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  const selectedCustomPersonas = customPersonas.filter((c) => selectedCustom.includes(c.id));

  function buildRequest(): PanelRequest {
    const isByo = conceptId === BYO;
    // Only send non-empty overrides.
    const overridesOut: Record<string, Partial<PersonaSpec>> = {};
    Object.entries(segmentOverrides).forEach(([id, ov]) => {
      if (ov && Object.keys(ov).length) overridesOut[id] = ov;
    });
    return {
      conceptId: isByo ? undefined : conceptId,
      conceptText: isByo ? byoText : undefined,
      conceptName: isByo ? byoName : undefined,
      segments: selectedSegs,
      nPer,
      live,
      seed: 7,
      ...(selectedCustomPersonas.length ? { customPersonas: selectedCustomPersonas } : {}),
      ...(Object.keys(overridesOut).length ? { segmentOverrides: overridesOut } : {}),
    };
  }

  // Single source of truth: reuse the shared resolver so the Results header AND
  // theme mining (Top appeals/objections) reflect the real BYO concept, not the
  // catalogue card's phrases.
  function resolveConcept(req: PanelRequest): Concept {
    return resolveConceptForPanel(req);
  }

  // The run is valid if there is at least one catalogue segment OR one selected
  // custom persona, and (for a BYO concept) the concept text is non-empty.
  const hasUnits = selectedSegs.length > 0 || selectedCustomPersonas.length > 0;
  const byoEmpty = conceptId === BYO && !byoText.trim();
  const runDisabled = running || !hasUnits || byoEmpty;

  async function runPanel() {
    if (!hasUnits) {
      setNotice("Select at least one segment or custom persona to run the panel.");
      return;
    }
    setRunning(true);
    setNotice(null);
    const req = buildRequest();
    const concept = resolveConcept(req);
    setActiveConcept(concept);
    setActiveRequest(req);
    setActiveCustom(selectedCustomPersonas);

    // Snapshot each resolved unit's persona AS RUN, so a later interview uses the
    // persona this run actually used — not segmentOverrides edited afterwards.
    // Catalogue units use the merged persona (base + overrides); BYO units use
    // the custom persona's spec. Mirrors how activeConcept/activeCustom snapshot.
    const personaSnapshot: Record<string, PersonaSpec> = {};
    selectedSegs.forEach((segId) => {
      const seg = segments.find((s) => s.id === segId);
      const merged = seg ? mergedPersona(seg) : undefined;
      if (merged) personaSnapshot[segId] = merged;
    });
    selectedCustomPersonas.forEach((cp) => {
      personaSnapshot[cp.id] = cp.spec;
    });
    setActiveUnitPersonas(personaSnapshot);
    // A new run invalidates any open interview + ask-the-panel results.
    setActiveInterview(null);
    setAskResults(null);
    setRunSeq((n) => n + 1);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch("/api/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PanelResponse;
      setResponse(data);
      if (data.meta?.note) {
        // meta.note carries the most specific message — e.g. the respondent-cap
        // reduction note, and/or the Vertex fallback reason (panel.ts always sets
        // a note when it falls back). Prefer it so the cap notice is never hidden
        // behind the generic fallback line.
        setNotice(data.meta.note);
      } else if (data.fellBack) {
        setNotice(
          "Live elicitation was unavailable — results shown are from the stage-safety fallback (offline)."
        );
      } else {
        setNotice(null);
      }
    } catch {
      // Network/timeout: run the full offline panel locally so the demo never dies.
      const local = samplePanel(req);
      setResponse(local);
      setNotice(
        "Server unreachable — running the stage-safety fallback locally in the browser."
      );
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }

  /* ----- Open a 1:1 interview from a verbatim ----- */
  function openInterview(unit: Unit, i: number, seed: { text?: string; situation?: string }) {
    const persona = activeUnitPersonas[unit.id];
    if (!persona) return; // no snapshot for this unit — button is hidden in that case
    setActiveInterview({
      conversationKey: `${runSeq}-${unit.id}-${i}`,
      unit,
      persona,
      seed,
    });
  }

  /* ----- Ask the panel: one broadcast question → a reply per unit -----
     Reuses buildRequest() for the concept + units (segments/customPersonas/
     overrides), omitting nPer/live/seed, and adds the question. Never-die:
     on any error fall back to a graceful offline reply per resolved unit. */
  async function askPanel() {
    const q = askQuestion.trim();
    if (!q || askLoading) return;
    setAskLoading(true);
    // Use the request AS RUN (not the live controls) so Ask-the-panel matches
    // the displayed results even if units/personas were edited after the run.
    const req = activeRequest ?? buildRequest();
    const body = {
      conceptId: req.conceptId,
      conceptText: req.conceptText,
      conceptName: req.conceptName,
      segments: req.segments,
      ...(req.customPersonas ? { customPersonas: req.customPersonas } : {}),
      ...(req.segmentOverrides ? { segmentOverrides: req.segmentOverrides } : {}),
      question: q,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { perUnit?: AskResult[] };
      const rows = Array.isArray(data.perUnit) ? data.perUnit : [];
      setAskResults(rows.length ? rows : askFallback());
    } catch {
      // Network/timeout: synthesise a graceful offline reply per result unit so
      // the focus group never returns blank.
      setAskResults(askFallback());
    } finally {
      clearTimeout(timer);
      setAskLoading(false);
    }
  }

  /** Offline per-unit replies for "ask the panel" (used on network failure). */
  function askFallback(): AskResult[] {
    return resultUnits
      .filter((u) => response?.perSegment[u.id])
      .map((u) => ({
        unitId: u.id,
        name: u.name,
        color: u.color,
        reply:
          "I can't get online to think that through right now — but on the whole it comes down to whether it fits my budget and how I manage my money.",
      }));
  }

  const summary = useMemo(() => {
    if (!response || !activeConcept) return null;
    const units = resolveUnits(response, segments, activeCustom);
    const present = units.filter((u) => response.perSegment[u.id]);
    return summarise(response, activeConcept, present);
  }, [response, activeConcept, segments, activeCustom]);

  const resultUnits = useMemo(
    () => (response ? resolveUnits(response, segments, activeCustom) : []),
    [response, segments, activeCustom]
  );

  return (
    <div className="min-h-full" style={{ background: PAPER }}>
      <Header tab={tab} setTab={setTab} />
      <PartnerStrip />

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        {tab === "panel" && (
          <PanelTab
            concepts={concepts}
            segments={segments}
            conceptId={conceptId}
            setConceptId={setConceptId}
            byoName={byoName}
            setByoName={setByoName}
            byoText={byoText}
            setByoText={setByoText}
            selectedSegs={selectedSegs}
            toggleSeg={toggleSeg}
            nPer={nPer}
            setNPer={setNPer}
            live={live}
            setLive={setLive}
            running={running}
            runDisabled={runDisabled}
            runPanel={runPanel}
            response={response}
            activeConcept={activeConcept}
            summary={summary}
            resultUnits={resultUnits}
            notice={notice}
            mergedPersona={mergedPersona}
            hasOverride={hasOverride}
            setSegmentPersona={setSegmentPersona}
            resetSegmentPersona={resetSegmentPersona}
            customPersonas={customPersonas}
            selectedCustom={selectedCustom}
            addCustomPersona={addCustomPersona}
            updateCustomPersona={updateCustomPersona}
            updateCustomSpec={updateCustomSpec}
            removeCustomPersona={removeCustomPersona}
            toggleCustom={toggleCustom}
            openInterview={openInterview}
            canInterview={(unitId) => !!activeUnitPersonas[unitId]}
            askQuestion={askQuestion}
            setAskQuestion={setAskQuestion}
            askResults={askResults}
            askLoading={askLoading}
            askPanel={askPanel}
          />
        )}
        {tab === "method" && <MethodTab />}
        {tab === "deploy" && <DeployTab />}
      </main>

      <Footer />

      {activeInterview && activeConcept && (
        <InterviewDrawer
          open={!!activeInterview}
          onClose={() => setActiveInterview(null)}
          conversationKey={activeInterview.conversationKey}
          unit={activeInterview.unit}
          persona={activeInterview.persona}
          concept={activeConcept}
          seed={activeInterview.seed}
        />
      )}
    </div>
  );
}

/* ============================================================
   Header
   ============================================================ */
function Header({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <header style={{ background: "#fff", borderBottom: `1px solid ${LINE}` }}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Hexagon size={34} />
          <div className="leading-tight">
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 20, fontWeight: 800, color: INK, letterSpacing: -0.5 }}>
                {BRAND_NAME}
              </span>
              <span
                className="font-display"
                style={{ fontSize: 19, fontWeight: 600, fontStyle: "italic", color: ACCENT }}
              >
                {PRODUCT_NAME}
              </span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.6, color: MUTED }}>
              {PRODUCT_KICKER}
            </div>
          </div>
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Primary">
          {TABS.map((t) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={selected ? "page" : undefined}
                className="rounded-lg px-4 py-2 font-semibold transition"
                style={{
                  fontSize: 14,
                  color: selected ? "#fff" : INK,
                  background: selected ? ACCENT : "transparent",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

/* ============================================================
   Partner strip — makes the demo framing explicit (GCP / Salesforce / Cognizant)
   ============================================================ */
function PartnerStrip() {
  return (
    <div style={{ background: "#fff", borderBottom: `1px solid ${LINE}` }}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: MUTED }}>
          INDEPENDENT DEMO · NOT AFFILIATED WITH HSBC
        </span>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <img src="/logos/googlecloud.svg" alt="Google Cloud" style={{ height: 22 }} />
          <img src="/logos/salesforce.svg" alt="Salesforce" style={{ height: 22 }} />
          <img src="/logos/cognizant.svg" alt="Cognizant" style={{ height: 16 }} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Footer — DISCLAIMER verbatim
   ============================================================ */
function Footer() {
  return (
    <footer className="mt-8" style={{ borderTop: `1px solid ${LINE}`, background: "#fff" }}>
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
        <p style={{ fontSize: 12, lineHeight: 1.6, color: "#55606A" }}>{DISCLAIMER}</p>
        <p className="mt-1" style={{ fontSize: 12, color: "#55606A" }}>
          Source:{" "}
          <a
            href="https://arxiv.org/abs/2510.08338"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: ACCENT, textDecoration: "underline" }}
          >
            Maier et al. (2025), arXiv:2510.08338
          </a>
        </p>
      </div>
    </footer>
  );
}

/* ============================================================
   Panel tab
   ============================================================ */
interface PanelTabProps {
  concepts: Concept[];
  segments: Segment[];
  conceptId: string;
  setConceptId: (s: string) => void;
  byoName: string;
  setByoName: (s: string) => void;
  byoText: string;
  setByoText: (s: string) => void;
  selectedSegs: string[];
  toggleSeg: (id: string) => void;
  nPer: number;
  setNPer: (n: number) => void;
  live: boolean;
  setLive: (b: boolean) => void;
  running: boolean;
  runDisabled: boolean;
  runPanel: () => void;
  response: PanelResponse | null;
  activeConcept: Concept | null;
  summary: PanelSummary | null;
  resultUnits: Unit[];
  notice: string | null;
  /* persona studio */
  mergedPersona: (seg: Segment) => PersonaSpec | undefined;
  hasOverride: (segId: string) => boolean;
  setSegmentPersona: (seg: Segment, next: PersonaSpec) => void;
  resetSegmentPersona: (segId: string) => void;
  customPersonas: CustomPersona[];
  selectedCustom: string[];
  addCustomPersona: () => void;
  updateCustomPersona: (id: string, patch: Partial<CustomPersona>) => void;
  updateCustomSpec: (id: string, spec: PersonaSpec) => void;
  removeCustomPersona: (id: string) => void;
  toggleCustom: (id: string) => void;
  /* synthetic chat */
  openInterview: (unit: Unit, i: number, seed: { text?: string; situation?: string }) => void;
  canInterview: (unitId: string) => boolean;
  askQuestion: string;
  setAskQuestion: (s: string) => void;
  askResults: AskResult[] | null;
  askLoading: boolean;
  askPanel: () => void;
}

function PanelTab(p: PanelTabProps) {
  const isByo = p.conceptId === BYO;
  const currentConcept = isByo ? undefined : conceptById(p.conceptId);

  const respondentCount =
    (p.selectedSegs.length + p.selectedCustom.length) * p.nPer;

  // Why is "Run panel" disabled? Surface a short, specific reason beneath it.
  const noUnits = p.selectedSegs.length === 0 && p.selectedCustom.length === 0;
  const byoConceptEmpty = isByo && !p.byoText.trim();
  const runDisabledReason = p.running
    ? null
    : noUnits
    ? "Select at least one segment or persona"
    : byoConceptEmpty
    ? "Describe your concept first"
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      {/* ----- Controls column (sticky so it stays visible past a long transcript) ----- */}
      <div className="grid min-w-0 content-start gap-4 self-start lg:sticky lg:top-4">
        <Card className="p-5">
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Concept</h2>
          <label htmlFor="concept" className="sr-only">
            Concept
          </label>
          <select
            id="concept"
            value={p.conceptId}
            onChange={(e) => p.setConceptId(e.target.value)}
            className="mt-2 w-full rounded-lg px-3 py-2"
            style={{ border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FAFBFB" }}
          >
            {p.concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={BYO}>Bring your own concept…</option>
          </select>

          {isByo ? (
            <div className="mt-3 grid gap-2">
              <label htmlFor="byo-name" className="sr-only">
                Concept name
              </label>
              <input
                id="byo-name"
                value={p.byoName}
                onChange={(e) => p.setByoName(e.target.value)}
                className="w-full rounded-lg px-3 py-2"
                style={{ border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FAFBFB" }}
                placeholder="Concept name"
              />
              <label htmlFor="byo-text" className="sr-only">
                Concept description
              </label>
              <textarea
                id="byo-text"
                value={p.byoText}
                onChange={(e) => p.setByoText(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-lg px-3 py-2"
                style={{ border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FAFBFB" }}
                placeholder="Describe the product, fees, rate and headline features…"
              />
            </div>
          ) : (
            currentConcept && (
              <div className="mt-3">
                <span
                  className="inline-block rounded-full px-2 py-0.5"
                  style={{ fontSize: 11, fontWeight: 600, color: ACCENT, background: "#FCEFF0" }}
                >
                  {currentConcept.tag}
                </span>
                <p
                  className="mt-2"
                  style={{ fontSize: 13, lineHeight: 1.5, color: MUTED, overflowWrap: "anywhere" }}
                >
                  {currentConcept.desc}
                </p>
              </div>
            )
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <label htmlFor="nper" style={{ fontSize: 15, fontWeight: 700, color: INK }}>
              Respondents per unit
            </label>
            <span className="font-mono" style={{ fontSize: 15, fontWeight: 600, color: ACCENT }}>
              {p.nPer}
            </span>
          </div>
          <input
            id="nper"
            type="range"
            min={4}
            max={10}
            step={1}
            value={p.nPer}
            onChange={(e) => p.setNPer(Number(e.target.value))}
            className="mt-3 w-full"
            style={{ accentColor: ACCENT }}
          />

          <label className="mt-4 flex cursor-pointer items-center justify-between">
            <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>
              Live elicitation
              <span className="block" style={{ fontSize: 11, fontWeight: 400, color: MUTED }}>
                Vertex AI Gemini, with offline fallback
              </span>
            </span>
            <input
              type="checkbox"
              checked={p.live}
              onChange={(e) => p.setLive(e.target.checked)}
              style={{ accentColor: ACCENT, width: 18, height: 18 }}
            />
          </label>

          <p className="mt-4 text-center" style={{ fontSize: 11, color: MUTED }}>
            {p.selectedSegs.length + p.selectedCustom.length} unit
            {p.selectedSegs.length + p.selectedCustom.length === 1 ? "" : "s"} × {p.nPer} ={" "}
            <span style={{ fontWeight: 600, color: INK }}>{respondentCount}</span> synthetic respondents
          </p>
          <button
            type="button"
            onClick={p.runPanel}
            disabled={p.runDisabled}
            aria-describedby={runDisabledReason ? "run-disabled-reason" : undefined}
            className="mt-2 w-full rounded-lg px-4 py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: ACCENT, fontSize: 15 }}
          >
            {p.running ? "Running panel…" : "Run panel"}
          </button>
          {runDisabledReason && (
            <p
              id="run-disabled-reason"
              className="mt-2 text-center"
              style={{ fontSize: 11, color: MUTED }}
            >
              {runDisabledReason}
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Segments</h2>
          <div className="mt-2 grid gap-2">
            {p.segments.map((s) => (
              <SegmentRow
                key={s.id}
                seg={s}
                on={p.selectedSegs.includes(s.id)}
                toggle={() => p.toggleSeg(s.id)}
                persona={p.mergedPersona(s)}
                edited={p.hasOverride(s.id)}
                onPersonaChange={(next) => p.setSegmentPersona(s, next)}
                onReset={() => p.resetSegmentPersona(s.id)}
              />
            ))}
          </div>
        </Card>

        {/* ----- Bring your own persona ----- */}
        <Card className="p-5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h2 className="min-w-0" style={{ fontSize: 15, fontWeight: 700, color: INK }}>
              Bring your own persona
            </h2>
            <button
              type="button"
              onClick={p.addCustomPersona}
              disabled={p.customPersonas.length >= MAX_CUSTOM}
              aria-disabled={p.customPersonas.length >= MAX_CUSTOM}
              title={
                p.customPersonas.length >= MAX_CUSTOM
                  ? `Maximum ${MAX_CUSTOM} personas`
                  : undefined
              }
              className="shrink-0 rounded-lg px-2.5 py-1 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ fontSize: 12, color: "#fff", background: ACCENT }}
            >
              + Add persona
            </button>
          </div>
          <p className="mt-1" style={{ fontSize: 11, color: MUTED }}>
            Author up to {MAX_CUSTOM} bespoke personas. Each runs as an extra unit alongside the
            catalogue.
          </p>
          {p.customPersonas.length === 0 ? (
            <p
              className="mt-3 rounded-lg px-3 py-3 text-center"
              style={{ fontSize: 12, color: MUTED, background: "#FAFBFB", border: `1px dashed ${LINE}` }}
            >
              No custom personas yet.
            </p>
          ) : (
            <div className="mt-3 grid gap-3">
              {p.customPersonas.map((c) => (
                <CustomPersonaCard
                  key={c.id}
                  persona={c}
                  selected={p.selectedCustom.includes(c.id)}
                  onToggle={() => p.toggleCustom(c.id)}
                  onName={(name) => p.updateCustomPersona(c.id, { name })}
                  onSpec={(spec) => p.updateCustomSpec(c.id, spec)}
                  onRemove={() => p.removeCustomPersona(c.id)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ----- Results column ----- */}
      <div className="flex min-w-0 flex-col gap-4">
        {p.notice && (
          <div
            role="status"
            className="rounded-lg px-4 py-3"
            style={{ background: "#FBF4E7", border: "1px solid #E8D7A8", fontSize: 13, color: "#6F5A1E" }}
          >
            {p.notice}
          </div>
        )}

        {!p.response && (
          <Card className="flex min-h-[60vh] flex-1 flex-col items-center justify-start p-8 pt-16 text-center">
            <div className="mx-auto mb-3 flex justify-center">
              <Hexagon size={40} />
            </div>
            <h2 className="font-display" style={{ fontSize: 27, fontWeight: 600, color: INK }}>
              Synthetic consumer panel
            </h2>
            <p className="mx-auto mt-2 max-w-md" style={{ fontSize: 14, lineHeight: 1.6, color: MUTED }}>
              Choose a concept and segments, edit personas or bring your own, then run the panel. Each
              synthetic respondent answers in free text; semantic similarity rating (SSR) maps every
              answer to a full Likert distribution — not a single forced number.
            </p>
            <div className="mt-5">
              <Spectrum />
            </div>
          </Card>
        )}

        {p.response && p.summary && p.activeConcept && (
          <Results
            response={p.response}
            concept={p.activeConcept}
            summary={p.summary}
            units={p.resultUnits}
            openInterview={p.openInterview}
            canInterview={p.canInterview}
            askQuestion={p.askQuestion}
            setAskQuestion={p.setAskQuestion}
            askResults={p.askResults}
            askLoading={p.askLoading}
            askPanel={p.askPanel}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Segment row — checkbox + brief, with a collapsible inline persona editor.
   ============================================================ */
function SegmentRow({
  seg,
  on,
  toggle,
  persona,
  edited,
  onPersonaChange,
  onReset,
}: {
  seg: Segment;
  on: boolean;
  toggle: () => void;
  persona: PersonaSpec | undefined;
  edited: boolean;
  onPersonaChange: (next: PersonaSpec) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-lg"
      style={{ border: `1px solid ${on ? ACCENT : LINE}`, background: on ? "#FCEFF0" : "#fff" }}
    >
      <label className="flex cursor-pointer items-start gap-3 p-2">
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          className="mt-1"
          style={{ accentColor: ACCENT }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="inline-block shrink-0 rounded-full"
              style={{ width: 9, height: 9, background: seg.color }}
            />
            <span className="min-w-0" style={{ fontSize: 13, fontWeight: 600, color: INK }}>
              {seg.name}
            </span>
            {edited && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5"
                style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: "#fff", background: ACCENT }}
              >
                EDITED
              </span>
            )}
          </span>
          {/* Reflect any inline edit: derive the one-line summary from the MERGED
              persona so the collapsed brief never goes stale. */}
          <span
            className="mt-0.5 block"
            style={{ fontSize: 11, color: MUTED, overflowWrap: "anywhere" }}
          >
            {persona ? conciseSummary(persona) : seg.brief}
          </span>
        </span>
      </label>

      {persona && (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="font-semibold"
              style={{ fontSize: 11, color: ACCENT, background: "transparent" }}
            >
              {open ? "Hide persona" : "Edit persona"}
            </button>
            {edited && (
              <button
                type="button"
                onClick={onReset}
                className="font-semibold"
                style={{ fontSize: 11, color: MUTED, background: "transparent" }}
              >
                Reset
              </button>
            )}
          </div>
          {open && (
            <div
              className="mt-2 rounded-lg p-3"
              style={{ background: "#fff", border: `1px solid ${LINE}` }}
            >
              <PersonaForm dense idPrefix={seg.id} value={persona} onChange={onPersonaChange} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Custom persona card — name input + selectable checkbox + remove + form.
   Mirrors the BYO-concept visual style.
   ============================================================ */
function CustomPersonaCard({
  persona,
  selected,
  onToggle,
  onName,
  onSpec,
  onRemove,
}: {
  persona: CustomPersona;
  selected: boolean;
  onToggle: () => void;
  onName: (name: string) => void;
  onSpec: (spec: PersonaSpec) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ border: `1px solid ${selected ? ACCENT : LINE}`, background: selected ? "#FCEFF0" : "#fff" }}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Include ${persona.name}`}
          style={{ accentColor: ACCENT }}
        />
        <span
          aria-hidden
          className="inline-block shrink-0 rounded-full"
          style={{ width: 9, height: 9, background: persona.color }}
        />
        <input
          value={persona.name}
          onChange={(e) => onName(e.target.value)}
          aria-label="Persona name"
          placeholder="Name this persona, e.g. 'Self-employed couple, Leeds'"
          className="min-w-0 flex-1 rounded-md px-2 py-1"
          style={{ border: `1px solid ${LINE}`, fontSize: 13, fontWeight: 600, color: INK, background: "#FAFBFB" }}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${persona.name}`}
          className="shrink-0 rounded-md px-2 py-1 font-semibold"
          style={{ fontSize: 11, color: MUTED, background: "transparent", border: `1px solid ${LINE}` }}
        >
          Remove
        </button>
      </div>
      <div className="mt-3 rounded-lg p-3" style={{ background: "#fff", border: `1px solid ${LINE}` }}>
        <PersonaForm dense idPrefix={persona.id} value={persona.spec} onChange={onSpec} />
      </div>
    </div>
  );
}

/* ============================================================
   Results — KPIs, ranking, overall + per-segment pmf, themes, verbatims
   ============================================================ */
function Results({
  response,
  concept,
  summary,
  units,
  openInterview,
  canInterview,
  askQuestion,
  setAskQuestion,
  askResults,
  askLoading,
  askPanel,
}: {
  response: PanelResponse;
  concept: Concept;
  summary: PanelSummary;
  units: Unit[];
  openInterview: (unit: Unit, i: number, seed: { text?: string; situation?: string }) => void;
  canInterview: (unitId: string) => boolean;
  askQuestion: string;
  setAskQuestion: (s: string) => void;
  askResults: AskResult[] | null;
  askLoading: boolean;
  askPanel: () => void;
}) {
  const strongest = summary.ranking[0];
  const weakest = summary.ranking[summary.ranking.length - 1];
  const modeLabel =
    response.mode === "live"
      ? `Live · ${response.meta?.ssr === "embedding" ? "embedding SSR" : "lexical SSR"}${
          response.meta?.personaReasoning ? " · persona reasoning" : ""
        }`
      : "Stage-safety fallback (offline)";

  return (
    <div className="grid gap-4">
      {/* Concept header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display" style={{ fontSize: 22, fontWeight: 600, color: INK }}>{concept.name}</h2>
              <span
                className="rounded-full px-2 py-0.5"
                style={{ fontSize: 11, fontWeight: 600, color: ACCENT, background: "#FCEFF0" }}
              >
                {concept.tag}
              </span>
            </div>
            <p className="mt-1 max-w-2xl" style={{ fontSize: 13, lineHeight: 1.5, color: MUTED }}>
              {concept.desc}
            </p>
          </div>
          <span
            className="rounded-full px-3 py-1"
            style={{ fontSize: 11, fontWeight: 600, color: MUTED, background: PAPER }}
          >
            {modeLabel}
          </span>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Mean PI" value={summary.meanPI.toFixed(2)} sub="1–5 purchase intent" accent />
        <Kpi
          label="Would apply"
          value={`${Math.round(summary.applyShare * 100)}%`}
          sub="mass on 4–5"
        />
        <Kpi
          label="Strongest unit"
          value={strongest ? strongest.unit.name : "—"}
          sub={strongest ? `Mean PI ${strongest.res.mean.toFixed(2)}` : undefined}
          mono={false}
        />
        <Kpi
          label="Weakest unit"
          value={weakest ? weakest.unit.name : "—"}
          sub={weakest ? `Mean PI ${weakest.res.mean.toFixed(2)}` : undefined}
          mono={false}
        />
      </div>

      {/* Ask the panel — one question, every unit answers (synthetic focus group) */}
      <AskPanelCard
        askQuestion={askQuestion}
        setAskQuestion={setAskQuestion}
        askResults={askResults}
        askLoading={askLoading}
        askPanel={askPanel}
      />

      {/* Overall distribution */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Overall distribution</h3>
          <span style={{ fontSize: 12, color: MUTED }}>{summary.nRespondents} synthetic respondents</span>
        </div>
        <div className="mt-3">
          <PmfBars pmf={summary.overallPmf} height={28} />
        </div>
      </Card>

      {/* Unit ranking with per-unit pmf bars */}
      <Card className="p-5">
        <h3 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Unit ranking</h3>
        <div className="mt-3 grid gap-3">
          {summary.ranking.map(({ unit, res }, idx) => {
            const maxMean = summary.ranking[0]?.res.mean || 5;
            const widthPct = Math.max(8, (res.mean / Math.max(maxMean, 5)) * 100);
            return (
              <div key={unit.id}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2" style={{ fontSize: 13, color: INK }}>
                    <span
                      className="flex items-center justify-center rounded-full"
                      style={{
                        width: 18,
                        height: 18,
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#fff",
                        background: unit.color,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ fontWeight: 600 }}>{unit.name}</span>
                  </span>
                  <span className="font-mono" style={{ fontSize: 13, color: INK }}>
                    {res.mean.toFixed(2)}
                    <span style={{ color: MUTED }}> · {Math.round(res.applyShare * 100)}% apply</span>
                  </span>
                </div>
                {/* ranking bar */}
                <div
                  className="mt-1 h-2 w-full overflow-hidden rounded-full"
                  style={{ background: PAPER }}
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${widthPct}%`, background: unit.color, transition: "width 240ms ease" }}
                  />
                </div>
                {/* per-unit pmf */}
                <div className="mt-2">
                  <PmfBars pmf={res.pmf} height={16} showScale={false} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Theme cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col p-5">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Top objections</h3>
          {summary.topObjections.length ? (
            <div className="mt-3 grid gap-2">
              {summary.topObjections.map((o) => (
                <ThemeCard key={o.label} kind="objection" label={o.label} count={o.count} share={o.share} />
              ))}
            </div>
          ) : (
            <div
              className="mt-3 flex flex-1 flex-col items-center justify-center text-center"
              style={{ minHeight: 96 }}
            >
              <p style={{ fontSize: 13, color: MUTED }}>No objections surfaced in this run.</p>
            </div>
          )}
        </Card>
        <Card className="flex flex-col p-5">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Top appeals</h3>
          {summary.topAppeals.length ? (
            <div className="mt-3 grid gap-2">
              {summary.topAppeals.map((a) => (
                <ThemeCard key={a.label} kind="appeal" label={a.label} count={a.count} share={a.share} />
              ))}
            </div>
          ) : (
            <div
              className="mt-3 flex flex-1 flex-col items-center justify-center text-center"
              style={{ minHeight: 96 }}
            >
              <p style={{ fontSize: 13, color: MUTED }}>No clear appeals surfaced in this run.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Verbatims grouped by unit, each with a per-respondent pmf strip */}
      <Card className="p-5">
        <h3 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Verbatims</h3>
        <p className="mt-1" style={{ fontSize: 12, color: MUTED }}>
          What a Likert number alone would never tell you. Each strip is that respondent’s full Likert
          distribution.
        </p>
        <div className="mt-4 grid gap-5">
          {units
            .filter((u) => response.perSegment[u.id])
            .map((unit) => {
              const res = response.perSegment[unit.id]!;
              return (
                <div key={unit.id}>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block rounded-full"
                      style={{ width: 10, height: 10, background: unit.color }}
                    />
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: INK }}>{unit.name}</h4>
                    <span className="font-mono" style={{ fontSize: 12, color: MUTED }}>
                      mean {res.mean.toFixed(2)}
                    </span>
                  </div>
                  <ul className="mt-2 grid gap-2">
                    {res.responses.map((r, i) => (
                      <li
                        key={i}
                        className="flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center sm:justify-between"
                        style={{ border: `1px solid ${LINE}`, background: "#fff" }}
                      >
                        <div className="min-w-0">
                          {r.situation && (
                            <div
                              className="mb-2 pl-2.5"
                              style={{ borderLeft: `3px solid ${unit.color}` }}
                            >
                              <div
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  letterSpacing: 0.6,
                                  textTransform: "uppercase",
                                  color: MUTED,
                                }}
                              >
                                Modelled reasoning
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  lineHeight: 1.45,
                                  color: "#4A535B",
                                }}
                              >
                                {r.situation}
                              </div>
                            </div>
                          )}
                          <p style={{ fontSize: 13, lineHeight: 1.5, color: INK }}>“{r.text}”</p>
                          <span
                            className="mt-1 inline-block rounded-full px-2 py-0.5"
                            style={{ fontSize: 10, fontWeight: 600, color: MUTED, background: PAPER }}
                          >
                            {r.driver}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <PmfStrip pmf={r.pmf} />
                          <span className="font-mono" style={{ fontSize: 12, color: MUTED }}>
                            {r.mean.toFixed(1)}
                          </span>
                          {canInterview(unit.id) && (
                            <button
                              type="button"
                              onClick={() =>
                                openInterview(unit, i, { text: r.text, situation: r.situation })
                              }
                              className="shrink-0 rounded-lg px-2.5 py-1 font-semibold transition"
                              style={{
                                fontSize: 11,
                                color: ACCENT,
                                background: "#fff",
                                border: `1px solid ${LINE}`,
                              }}
                            >
                              Interview
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Ask the panel — one broadcast question, a reply per unit
   (synthetic focus group). Mirrors the theme card styling.
   ============================================================ */
function AskPanelCard({
  askQuestion,
  setAskQuestion,
  askResults,
  askLoading,
  askPanel,
}: {
  askQuestion: string;
  setAskQuestion: (s: string) => void;
  askResults: AskResult[] | null;
  askLoading: boolean;
  askPanel: () => void;
}) {
  return (
    <Card className="p-5">
      <h3 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Ask the panel</h3>
      <p className="mt-1" style={{ fontSize: 12, color: MUTED }}>
        Put one question to every unit at once — a synthetic focus group. Each answers in character.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          askPanel();
        }}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="ask-panel-input" className="sr-only">
          Your question for the panel
        </label>
        <input
          id="ask-panel-input"
          value={askQuestion}
          onChange={(e) => setAskQuestion(e.target.value)}
          maxLength={400}
          placeholder="e.g. What would make you switch to this?"
          disabled={askLoading}
          className="min-w-0 flex-1 rounded-lg px-3 py-2 disabled:opacity-60"
          style={{ border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FAFBFB" }}
        />
        <button
          type="submit"
          disabled={askLoading || !askQuestion.trim()}
          className="shrink-0 rounded-lg px-4 py-2 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: ACCENT, fontSize: 14 }}
        >
          {askLoading ? "Asking…" : "Ask"}
        </button>
      </form>

      {askLoading && (
        <p className="mt-3" style={{ fontSize: 12, color: MUTED }} aria-live="polite">
          Putting the question to the panel…
        </p>
      )}

      {!askLoading && askResults && askResults.length > 0 && (
        <div className="mt-4 grid gap-2">
          {askResults.map((r) => (
            <div
              key={r.unitId}
              className="rounded-lg p-3"
              style={{ border: `1px solid ${LINE}`, background: "#fff" }}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block shrink-0 rounded-full"
                  style={{ width: 10, height: 10, background: r.color }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{r.name}</span>
              </div>
              <p
                className="mt-1.5"
                style={{ fontSize: 13, lineHeight: 1.5, color: INK, overflowWrap: "anywhere" }}
              >
                {r.reply}
              </p>
            </div>
          ))}
        </div>
      )}

      {!askLoading && askResults && askResults.length === 0 && (
        <p className="mt-3" style={{ fontSize: 12, color: MUTED }}>
          No units responded — run the panel, then ask again.
        </p>
      )}
    </Card>
  );
}

/* ---------- shallow value equality for persona diffing (scalars + string[]) ---------- */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

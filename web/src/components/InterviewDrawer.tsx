/* ============================================================
   InterviewDrawer.tsx — a 1:1 follow-up chat with one synthetic
   respondent. Opens from a verbatim, grounded in the run-snapshotted
   persona + concept + that respondent's seed reaction. All copy is
   British English; styling mirrors App.tsx / visuals.tsx (1px LINE
   borders, ACCENT actions, #FAFBFB fields).

   Safety / correctness invariants (see plan):
   - One AbortController per drawer instance. When `conversationKey`
     changes OR the drawer closes, any in-flight /api/chat request is
     aborted and the thread is CLEARED, so a late reply can never land
     in the wrong interview and a new respondent always starts fresh.
   - Never-die: any fetch error/timeout (~25s) appends a graceful,
     in-character offline line rather than crashing.
   - Respects prefers-reduced-motion (no slide transition then).
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Concept, PersonaSpec } from "@/domain";
import { INK, MUTED, LINE, ACCENT, PAPER } from "@/theme";

interface InterviewUnit {
  id: string;
  name: string;
  color: string;
}

export interface InterviewDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Stable key for this conversation (`${runSeq}-${unit.id}-${i}`). A change
   *  aborts any in-flight reply and resets the thread to empty. */
  conversationKey: string;
  unit: InterviewUnit;
  persona: PersonaSpec;
  concept: Concept;
  seed: { text?: string; situation?: string };
}

/* ---------- shape of the /api/chat response ---------- */
interface ChatApiResponse {
  reply?: unknown;
  mode?: unknown;
}

/* Starter prompts that prefill + send on click. British English. */
const STARTERS = [
  "Why is that?",
  "What would change your mind?",
  "What would you choose instead?",
];

const CHAT_TIMEOUT_MS = 25000;

/* ---------- helpers ---------- */
function fmtK(n: number): string {
  return n >= 1000 ? `£${Math.round(n / 1000)}k` : `£${Math.round(n)}`;
}

/** Compact one-line persona summary: age · region · £income · credit. */
function personaSummary(p: PersonaSpec): string {
  return `${p.age} · ${p.region || "UK"} · ${fmtK(p.grossIncome)} gross · ${p.creditPosture} credit`;
}

/** Graceful, in-character offline line derived from the seed reaction/situation.
 *  Used when the network/Vertex is unavailable so the interview never dies. */
function offlineLine(seed: { text?: string; situation?: string }): string {
  if (seed.situation && seed.situation.trim()) {
    return `Honestly, it comes back to my situation — ${seed.situation.trim()} So that's really what's driving how I feel about it.`;
  }
  if (seed.text && seed.text.trim()) {
    return `It's much as I said: ${seed.text.trim()} I'd stand by that, given where my money is at the moment.`;
  }
  return "I'd need a moment to think it through — but it really comes down to whether it fits my budget right now.";
}

export function InterviewDrawer({
  open,
  onClose,
  conversationKey,
  unit,
  persona,
  concept,
  seed,
}: InterviewDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [awaiting, setAwaiting] = useState(false);

  // One in-flight controller per drawer instance; aborted on key change/close.
  const controllerRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reduceMotion = usePrefersReducedMotion();

  // Always-current conversation key. The `conversationKey` prop captured inside an
  // async send() goes stale across the await, so late replies are validated against
  // this ref (updated every render) — never the captured value.
  const conversationKeyRef = useRef(conversationKey);
  conversationKeyRef.current = conversationKey;

  /* ----- Reset + abort when the conversation changes or the drawer closes -----
     This is the core safety invariant: clearing the thread and aborting any
     pending request guarantees a late reply can't append into a different
     interview, and every respondent starts from an empty thread. */
  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages([]);
    setDraft("");
    setAwaiting(false);
  }, [conversationKey, open]);

  /* ----- Escape to close ----- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* ----- Abort any in-flight request on unmount ----- */
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  /* ----- Keep the thread scrolled to the latest message ----- */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, awaiting]);

  /* ----- Focus the input when the drawer opens ----- */
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), reduceMotion ? 0 : 220);
      return () => clearTimeout(t);
    }
  }, [open, conversationKey, reduceMotion]);

  const isCustomConcept = concept.id === "custom";

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || awaiting) return;

    const userMsg: ChatMessage = { role: "user", text: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setDraft("");
    setAwaiting(true);

    // A fresh controller for this turn; abort any prior one first.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    // Pin the key this request belongs to: only commit a reply if the drawer
    // is still on the same conversation when it lands.
    const requestKey = conversationKey;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isCustomConcept
            ? { conceptText: concept.desc, conceptName: concept.name }
            : { conceptId: concept.id }),
          persona,
          unitName: unit.name,
          seed,
          messages: history,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ChatApiResponse;
      const reply =
        typeof data.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : offlineLine(seed);
      if (requestKey === conversationKeyRef.current) {
        setMessages((prev) => [...prev, { role: "persona", text: reply }]);
      }
    } catch {
      // Network/timeout/abort. Only append the graceful offline line if this is
      // still the active conversation AND it wasn't an intentional abort (a new
      // conversation reset will have changed conversationKey / cleared messages).
      if (requestKey === conversationKeyRef.current && !controller.signal.aborted) {
        setMessages((prev) => [...prev, { role: "persona", text: offlineLine(seed) }]);
      }
    } finally {
      clearTimeout(timer);
      if (requestKey === conversationKey) setAwaiting(false);
    }
  }

  if (!open) return null;

  const transition = reduceMotion ? "none" : "transform 240ms ease, opacity 240ms ease";

  return (
    <>
      {/* Translucent backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(28,28,28,0.38)",
          zIndex: 60,
          transition: reduceMotion ? "none" : "opacity 240ms ease",
        }}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Interview a respondent from ${unit.name}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          background: "#fff",
          borderLeft: `1px solid ${LINE}`,
          boxShadow: "-8px 0 28px rgba(28,28,28,0.14)",
          zIndex: 61,
          display: "flex",
          flexDirection: "column",
          transition,
        }}
      >
        {/* ---------- Header ---------- */}
        <header style={{ borderBottom: `1px solid ${LINE}`, padding: "16px 18px" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block shrink-0 rounded-full"
                  style={{ width: 10, height: 10, background: unit.color }}
                />
                <h2 className="min-w-0 truncate" style={{ fontSize: 15, fontWeight: 700, color: INK }}>
                  {unit.name}
                </h2>
              </div>
              <p className="mt-1" style={{ fontSize: 12, color: MUTED, overflowWrap: "anywhere" }}>
                {personaSummary(persona)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close interview"
              className="shrink-0 rounded-lg px-2 py-1 font-semibold"
              style={{ fontSize: 16, lineHeight: 1, color: MUTED, background: "transparent", border: `1px solid ${LINE}` }}
            >
              ✕
            </button>
          </div>

          {/* The original quote for context */}
          {seed.text && seed.text.trim() && (
            <p
              className="mt-3"
              style={{ fontSize: 13, lineHeight: 1.5, fontStyle: "italic", color: INK, overflowWrap: "anywhere" }}
            >
              “{seed.text.trim()}”
            </p>
          )}

          {/* Modelled reasoning line */}
          {seed.situation && seed.situation.trim() && (
            <div className="mt-2 pl-2.5" style={{ borderLeft: `3px solid ${unit.color}` }}>
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
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "#4A535B", overflowWrap: "anywhere" }}>
                {seed.situation.trim()}
              </div>
            </div>
          )}
        </header>

        {/* ---------- Message thread ---------- */}
        <div
          ref={threadRef}
          className="flex-1 overflow-y-auto"
          style={{ padding: "16px 18px", background: PAPER }}
        >
          {messages.length === 0 && !awaiting && (
            <div className="grid gap-3">
              <p style={{ fontSize: 13, lineHeight: 1.5, color: MUTED }}>
                Ask {unit.name.toLowerCase().startsWith("the") ? unit.name.toLowerCase() : "this respondent"} a
                follow-up. They answer in character, consistent with their finances. Try one of these to start:
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full px-3 py-1.5 font-semibold transition"
                    style={{
                      fontSize: 12,
                      color: ACCENT,
                      background: "#fff",
                      border: `1px solid ${LINE}`,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.length > 0 && (
            <div className="grid gap-3">
              {messages.map((m, i) => (
                <MessageBubble key={i} message={m} unitColor={unit.color} />
              ))}
              {awaiting && <TypingIndicator />}
            </div>
          )}
        </div>

        {/* ---------- Composer ---------- */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          style={{ borderTop: `1px solid ${LINE}`, padding: "12px 14px", background: "#fff" }}
        >
          <div className="flex items-center gap-2">
            <label htmlFor="interview-input" className="sr-only">
              Your follow-up question
            </label>
            <input
              id="interview-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={600}
              placeholder="Ask a follow-up…"
              disabled={awaiting}
              className="min-w-0 flex-1 rounded-lg px-3 py-2 disabled:opacity-60"
              style={{ border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FAFBFB" }}
            />
            <button
              type="submit"
              disabled={awaiting || !draft.trim()}
              className="shrink-0 rounded-lg px-4 py-2 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: ACCENT, fontSize: 14 }}
            >
              {awaiting ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

/* ============================================================
   Message bubble — user right (ACCENT tint), persona left (white).
   ============================================================ */
function MessageBubble({ message, unitColor }: { message: ChatMessage; unitColor: string }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="rounded-2xl px-3 py-2"
        style={{
          maxWidth: "84%",
          fontSize: 13,
          lineHeight: 1.5,
          color: INK,
          background: isUser ? "#FCEFF0" : "#fff",
          border: `1px solid ${isUser ? ACCENT : LINE}`,
          borderBottomRightRadius: isUser ? 4 : 16,
          borderBottomLeftRadius: isUser ? 16 : 4,
          overflowWrap: "anywhere",
        }}
      >
        {!isUser && (
          <span
            aria-hidden
            className="mb-1 inline-block rounded-full"
            style={{ width: 7, height: 7, marginRight: 6, background: unitColor }}
          />
        )}
        {message.text}
      </div>
    </div>
  );
}

/* ============================================================
   Typing indicator — "…typing" while awaiting a reply.
   ============================================================ */
function TypingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite">
      <div
        className="rounded-2xl px-3 py-2"
        style={{
          fontSize: 13,
          color: MUTED,
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderBottomLeftRadius: 4,
        }}
      >
        …typing
      </div>
    </div>
  );
}

/* ============================================================
   prefers-reduced-motion hook — disables the slide-in transition
   when the user has asked the OS to reduce motion.
   ============================================================ */
function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setReduce(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

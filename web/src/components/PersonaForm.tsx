/* ============================================================
   PersonaForm.tsx — controlled editor for a single PersonaSpec.
   Used both for light-editing a catalogue archetype's persona (dense,
   inline) and for authoring a bring-your-own persona. All copy is
   British English. Styling mirrors the existing inputs in App.tsx:
   1px LINE border, #FAFBFB field background, 13–14px text.

   Each instance MUST receive a UNIQUE `idPrefix` so element ids and
   their <label htmlFor> stay distinct across the several forms that
   render at once (inline archetype editors + up to three BYO cards).
   Colliding ids would be invalid HTML and mis-associate labels for
   screen-reader users.
   ============================================================ */
import type {
  PersonaSpec,
  Household,
  IncomeStability,
  CreditPosture,
} from "@/domain";
import { INK, MUTED, LINE } from "@/theme";

const FIELD_BG = "#FAFBFB";

const HOUSEHOLDS: { value: Household; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "couple", label: "Couple" },
  { value: "family", label: "Family" },
];

const INCOME_STABILITY: { value: IncomeStability; label: string }[] = [
  { value: "stable", label: "Stable" },
  { value: "variable", label: "Variable" },
  { value: "none", label: "None" },
  { value: "windfall", label: "Windfall" },
];

const CREDIT_POSTURE: { value: CreditPosture; label: string }[] = [
  { value: "averse", label: "Averse" },
  { value: "mainstream", label: "Mainstream" },
  { value: "reliant", label: "Reliant" },
];

/* ---------- shared field styling ---------- */
function inputStyle(dense: boolean): React.CSSProperties {
  return {
    border: `1px solid ${LINE}`,
    fontSize: dense ? 13 : 14,
    color: INK,
    background: FIELD_BG,
    width: "100%",
    borderRadius: 8,
    padding: dense ? "6px 8px" : "8px 10px",
  };
}

function labelStyle(dense: boolean): React.CSSProperties {
  return {
    fontSize: dense ? 11 : 12,
    fontWeight: 600,
    color: MUTED,
    display: "block",
    marginBottom: dense ? 2 : 4,
  };
}

interface FieldProps {
  label: string;
  htmlFor: string;
  dense: boolean;
  children: React.ReactNode;
  /** Span both columns in the dense 2-col grid (for wide inputs/textareas). */
  full?: boolean;
}
function Field({ label, htmlFor, dense, children, full }: FieldProps) {
  return (
    <div style={full ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}>
      <label htmlFor={htmlFor} style={labelStyle(dense)}>
        {label}
      </label>
      {children}
    </div>
  );
}

export interface PersonaFormProps {
  value: PersonaSpec;
  onChange: (s: PersonaSpec) => void;
  /**
   * Unique prefix for this form's element ids (e.g. a segment id or a
   * custom-persona id). Produces ids like `pf-${idPrefix}-age`, keeping
   * every concurrently-rendered form's labels distinctly associated.
   */
  idPrefix: string;
  /** Tighter spacing + 2-column grid for inline archetype editing. */
  dense?: boolean;
}

export function PersonaForm({ value, onChange, idPrefix, dense = false }: PersonaFormProps) {
  // A single patch helper keeps the spec immutable and fully typed.
  const set = <K extends keyof PersonaSpec>(key: K, v: PersonaSpec[K]) =>
    onChange({ ...value, [key]: v });

  // Build a collision-free id for a given field within this instance.
  const fid = (name: string) => `pf-${idPrefix}-${name}`;

  const lifeEventsText = value.lifeEvents.join(", ");
  const onLifeEvents = (raw: string) =>
    set(
      "lifeEvents",
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

  const gridStyle: React.CSSProperties = dense
    ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }
    : { display: "grid", gridTemplateColumns: "1fr", gap: 12 };

  const is = inputStyle(dense);

  return (
    <div style={gridStyle}>
      <Field label="Age" htmlFor={fid("age")} dense={dense}>
        <input
          id={fid("age")}
          type="number"
          min={18}
          max={90}
          value={value.age}
          onChange={(e) => set("age", clampInt(e.target.value, 18, 90, value.age))}
          style={is}
        />
      </Field>

      <Field label="Region" htmlFor={fid("region")} dense={dense}>
        <input
          id={fid("region")}
          type="text"
          value={value.region}
          onChange={(e) => set("region", e.target.value)}
          placeholder="e.g. Manchester"
          style={is}
        />
      </Field>

      <Field label="Household" htmlFor={fid("household")} dense={dense}>
        <select
          id={fid("household")}
          value={value.household}
          onChange={(e) => set("household", e.target.value as Household)}
          style={is}
        >
          {HOUSEHOLDS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Dependents" htmlFor={fid("dependents")} dense={dense}>
        <input
          id={fid("dependents")}
          type="number"
          min={0}
          max={8}
          value={value.dependents}
          onChange={(e) =>
            set("dependents", clampInt(e.target.value, 0, 8, value.dependents))
          }
          style={is}
        />
      </Field>

      <Field label="Gross household income (£)" htmlFor={fid("gross")} dense={dense}>
        <input
          id={fid("gross")}
          type="number"
          min={0}
          step={1000}
          value={value.grossIncome}
          onChange={(e) =>
            set("grossIncome", clampInt(e.target.value, 0, 100_000_000, value.grossIncome))
          }
          style={is}
        />
      </Field>

      <Field label="Income stability" htmlFor={fid("stability")} dense={dense}>
        <select
          id={fid("stability")}
          value={value.incomeStability}
          onChange={(e) => set("incomeStability", e.target.value as IncomeStability)}
          style={is}
        >
          {INCOME_STABILITY.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Liquid savings (£)" htmlFor={fid("liquid")} dense={dense}>
        <input
          id={fid("liquid")}
          type="number"
          min={0}
          step={500}
          value={value.liquidAssets}
          onChange={(e) =>
            set("liquidAssets", clampInt(e.target.value, 0, 100_000_000, value.liquidAssets))
          }
          style={is}
        />
      </Field>

      <Field label="Credit posture" htmlFor={fid("credit")} dense={dense}>
        <select
          id={fid("credit")}
          value={value.creditPosture}
          onChange={(e) => set("creditPosture", e.target.value as CreditPosture)}
          style={is}
        >
          {CREDIT_POSTURE.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Life events (comma-separated)"
        htmlFor={fid("events")}
        dense={dense}
        full
      >
        <input
          id={fid("events")}
          type="text"
          value={lifeEventsText}
          onChange={(e) => onLifeEvents(e.target.value)}
          placeholder="e.g. renting, new baby, redundancy"
          style={is}
        />
      </Field>

      <Field label="Notes" htmlFor={fid("notes")} dense={dense} full>
        <textarea
          id={fid("notes")}
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={dense ? 2 : 3}
          placeholder="Anything else that shapes how this person banks…"
          style={{ ...is, resize: "vertical" }}
        />
      </Field>
    </div>
  );
}

/* Parse an integer input, clamp to [min,max]; keep the previous value when blank/NaN. */
function clampInt(raw: string, min: number, max: number, prev: number): number {
  if (raw.trim() === "") return prev;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return prev;
  return Math.max(min, Math.min(max, n));
}

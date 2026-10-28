import { useState } from "react";
import { CATEGORY_LABEL, CATEGORY_LABEL_SW, LEVEL_LABEL, LEVEL_LABEL_SW, type Verdict } from "./api";

/** Highlights each rule's evidence inside the message so the user sees exactly what triggered it. */
export function Highlighted({ text, verdict }: { text: string; verdict: Verdict | null }) {
  const marks = (verdict?.signals ?? [])
    .map((s) => s.evidence)
    .filter((e) => e.length > 2 && text.includes(e))
    .sort((a, b) => b.length - a.length);
  if (marks.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, i) => (marks.includes(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}
    </>
  );
}

export function LevelBadge({ level, sw = false }: { level: Verdict["level"]; sw?: boolean }) {
  return <span className={`badge level-${level}`}>{(sw ? LEVEL_LABEL_SW : LEVEL_LABEL)[level]}</span>;
}

// Swahili mode shows only fixed, reviewed wording; the model's free-text explanation stays in English
// because Qwen3 4B's Swahili was not usable.
const T = {
  en: { rules: "Checked by rules", model: "The on-device model also noticed", todo: "What to do", toggle: "Kiswahili" },
  sw: { rules: "Ukaguzi wa sheria", model: "", todo: "Ufanye nini", toggle: "English" },
};

export function VerdictCard({ verdict, loading }: { verdict: Verdict | null; loading?: boolean }) {
  const [sw, setSw] = useState(false);
  if (!verdict) return <div className="card muted">{loading ? "Checking on this device…" : "Not checked yet."}</div>;
  const ruleSignals = verdict.signals.filter((s) => s.strength !== "weak");
  const t = T[sw ? "sw" : "en"];
  return (
    <div className={`card verdict level-${verdict.level}`}>
      <div className="verdict-head">
        <LevelBadge level={verdict.level} sw={sw} />
        <strong>{(sw ? CATEGORY_LABEL_SW : CATEGORY_LABEL)[verdict.category] ?? verdict.category}</strong>
        {loading && <span className="muted small">model still thinking…</span>}
        <button className="ghost lang" onClick={() => setSw(!sw)}>
          {t.toggle}
        </button>
      </div>

      {!sw && verdict.model && <p className={`explanation ${verdict.level === "safe" ? "muted" : ""}`}>{verdict.model.explanation}</p>}

      {ruleSignals.length > 0 && (
        <>
          <h4>{t.rules}</h4>
          <ul className="signals">
            {ruleSignals.map((s, i) => (
              <li key={i} className={`strength-${s.strength}`}>
                <code>{s.id}</code> {sw ? s.reasonSw : s.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      {!sw && verdict.model && verdict.model.red_flags.length > 0 && verdict.level !== "safe" && (
        <>
          <h4>{t.model}</h4>
          <ul className="flags">
            {verdict.model.red_flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}

      {verdict.advice.length > 0 && (
        <>
          <h4>{t.todo}</h4>
          <ul className="advice">
            {(sw ? verdict.adviceSw : verdict.advice).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}

      {sw ? (
        <p className="footnote">Maelezo ya modeli yanapatikana kwa Kiingereza tu. Maandishi haya ya Kiswahili yaliandikwa mapema na bado yanahitaji kukaguliwa na mzungumzaji asilia.</p>
      ) : (
        <p className="footnote">
          {verdict.decidedBy === "llm" ? "Raised by the on-device model; the rules found less." : "Level set by the rules; the model cannot lower it."}
          {verdict.model ? ` Model answered in ${(verdict.model.ms / 1000).toFixed(1)} s on this device.` : ""}
          {verdict.modelNote ? ` ${verdict.modelNote}` : ""}
        </p>
      )}
    </div>
  );
}

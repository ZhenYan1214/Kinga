import { CATEGORY_LABEL, LEVEL_LABEL, type Verdict } from "./api";

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

export function LevelBadge({ level }: { level: Verdict["level"] }) {
  return <span className={`badge level-${level}`}>{LEVEL_LABEL[level]}</span>;
}

export function VerdictCard({ verdict, loading }: { verdict: Verdict | null; loading?: boolean }) {
  if (!verdict) return <div className="card muted">{loading ? "Checking on this device…" : "Not checked yet."}</div>;
  const ruleSignals = verdict.signals.filter((s) => s.strength !== "weak");
  return (
    <div className={`card verdict level-${verdict.level}`}>
      <div className="verdict-head">
        <LevelBadge level={verdict.level} />
        <strong>{CATEGORY_LABEL[verdict.category] ?? verdict.category}</strong>
        {loading && <span className="muted small">model still thinking…</span>}
      </div>

      {verdict.model && verdict.level !== "safe" && <p className="explanation">{verdict.model.explanation}</p>}
      {verdict.model && verdict.level === "safe" && <p className="explanation muted">{verdict.model.explanation}</p>}

      {ruleSignals.length > 0 && (
        <>
          <h4>Checked by rules</h4>
          <ul className="signals">
            {ruleSignals.map((s, i) => (
              <li key={i} className={`strength-${s.strength}`}>
                <code>{s.id}</code> {s.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      {verdict.model && verdict.model.red_flags.length > 0 && verdict.level !== "safe" && (
        <>
          <h4>The on-device model also noticed</h4>
          <ul className="flags">
            {verdict.model.red_flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}

      {verdict.advice.length > 0 && (
        <>
          <h4>What to do</h4>
          <ul className="advice">
            {verdict.advice.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}

      <p className="footnote">
        {verdict.decidedBy === "llm" ? "Raised by the on-device model; the rules found less." : "Level set by the rules; the model cannot lower it."}
        {verdict.model ? ` Model answered in ${(verdict.model.ms / 1000).toFixed(1)} s on this device.` : ""}
        {verdict.modelNote ? ` ${verdict.modelNote}` : ""}
      </p>
    </div>
  );
}

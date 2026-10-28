// Act 1: every message in the inbox gets a verdict card, computed on this device.
import { useEffect, useRef, useState } from "react";
import { api, type InboxItem, type Verdict } from "./api";
import { Highlighted, LevelBadge, VerdictCard } from "./VerdictCard";

export function Inbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selected, setSelected] = useState<string>();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    api.inbox().then((list) => {
      setItems(list);
      setSelected(list[0]?.id);
      // Check messages one after another; the server queues them for the single on-device model.
      (async () => {
        for (const item of list) {
          setPending((p) => new Set(p).add(item.id));
          try {
            const verdict = await api.analyzeInbox(item.id);
            setItems((current) => current.map((m) => (m.id === item.id ? { ...m, verdict } : m)));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending((p) => {
              const next = new Set(p);
              next.delete(item.id);
              return next;
            });
          }
        }
      })();
    }, (e) => setError((e as Error).message));
  }, []);

  const current = items.find((m) => m.id === selected);

  return (
    <div className="inbox">
      <ul className="message-list">
        {items.map((m) => (
          <li key={m.id} className={m.id === selected ? "active" : ""} onClick={() => setSelected(m.id)}>
            <div className="row">
              <span className="sender">{m.contact ?? m.sender}</span>
              {m.verdict ? <LevelBadge level={m.verdict.level} /> : <span className="badge pending">{pending.has(m.id) ? "checking" : "…"}</span>}
            </div>
            <div className="preview">{m.text}</div>
            <div className="time">
              {m.time} · {m.channel === "whatsapp" ? "WhatsApp" : "SMS"}
            </div>
          </li>
        ))}
      </ul>
      <section className="detail">
        {error && <div className="card error">{error}</div>}
        {current && (
          <>
            <div className="card message">
              <div className="row">
                <strong>{current.contact ? `${current.contact} (${current.sender})` : current.sender}</strong>
                <span className="muted small">{current.contact ? "saved contact" : /^[+\d]/.test(current.sender) ? "unknown number" : "registered sender"}</span>
              </div>
              <p className="message-text">
                <Highlighted text={current.text} verdict={current.verdict} />
              </p>
            </div>
            <VerdictCard verdict={current.verdict} loading={pending.has(current.id)} />
          </>
        )}
        <CheckYourOwn />
      </section>
    </div>
  );
}

function CheckYourOwn() {
  const [text, setText] = useState("");
  const [sender, setSender] = useState("");
  const [contact, setContact] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      setVerdict(await api.analyze({ channel: "sms", sender, contact: contact || null, text }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card own">
      <summary>Check a message of your own</summary>
      <div className="form">
        <input placeholder="Who sent it? e.g. MPESA or 0712345678" value={sender} onChange={(e) => setSender(e.target.value)} />
        <input placeholder="Saved contact name, if any" value={contact} onChange={(e) => setContact(e.target.value)} />
        <textarea rows={4} placeholder="Paste the message" value={text} onChange={(e) => setText(e.target.value)} />
        <button disabled={!text.trim() || busy} onClick={check}>
          {busy ? "Checking on this device…" : "Check"}
        </button>
      </div>
      {verdict && (
        <>
          <p className="message-text">
            <Highlighted text={text} verdict={verdict} />
          </p>
          <VerdictCard verdict={verdict} />
        </>
      )}
    </details>
  );
}

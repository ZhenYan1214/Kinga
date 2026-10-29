// The user's M-PESA history as a balance chain: every genuine message must follow from the one before it.
// The user can import their own SMS export; it stays on this device.
import { useEffect, useState } from "react";
import { api, type InboxSource, type LedgerRow } from "./api";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS: Record<LedgerRow["status"], { label: string; className: string }> = {
  fits: { label: "fits", className: "ok" },
  contradicts: { label: "never happened", className: "bad" },
  does_not_fit: { label: "does not follow", className: "warn-text" },
  unverifiable: { label: "start of history", className: "muted" },
};

const KIND: Record<string, string> = { received: "Received from", sent: "Sent to", paybill: "Paybill", till: "Paid to", withdraw: "Withdrawn at", unknown: "Other" };

export function Ledger({ source, onSource }: { source?: InboxSource; onSource: (s: InboxSource) => void }) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.ledger().then(setRows, () => undefined);
  }, [source?.source, source?.messages]);

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNote(undefined);
    try {
      const result = await api.importInbox(await file.text());
      onSource(result);
      setNote(`Imported ${result.messages} received messages, ${result.mpesa} of them from MPESA. They stay on this device and are kept in memory only.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function backToDemo() {
    onSource(await api.useDemoInbox());
    setNote(undefined);
  }

  const forged = rows.filter((r) => r.status === "contradicts");

  return (
    <div className="card ledger">
      <div className="row">
        <h3>{source?.source === "imported" ? "Your M-PESA ledger (imported)" : "M-PESA ledger (demo: Amina Hassan)"}</h3>
        <div className="row buttons">
          <label className="file-button">
            {busy ? "Importing…" : "Import your SMS"}
            <input type="file" accept=".xml,text/xml" disabled={busy} onChange={(e) => importFile(e.target.files?.[0])} />
          </label>
          {source?.source === "imported" && (
            <button className="ghost" onClick={backToDemo}>
              Back to demo data
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        Every M-PESA confirmation states your new balance, so each one must follow from the one before it. A forged message cannot know your real
        balance, and the real messages around it still add up without it. To use your own messages, export them on Android with the free app
        "SMS Backup &amp; Restore" (XML) and import the file here. Only messages whose sender address is MPESA count; a number saved in your contacts
        as "M-Pesa" does not.
      </p>
      {note && <p className="small">{note}</p>}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th className="num">Change</th>
            <th className="num">Balance</th>
            <th>Chain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.status === "contradicts" ? "forged" : ""}>
              <td className="small">{r.time}</td>
              <td>
                {KIND[r.kind] ?? r.kind} {r.counterparty}
                <div className="mono small muted">{r.code}</div>
              </td>
              <td className={`num ${r.delta !== undefined && r.delta > 0 ? "ok" : ""}`}>
                {r.delta === undefined ? "" : `${r.delta > 0 ? "+" : "−"}${money(Math.abs(r.delta))}`}
              </td>
              <td className="num">{money(r.balance)}</td>
              <td className={STATUS[r.status].className} title={r.reason}>
                {r.status === "fits" ? "✓ " : r.status === "contradicts" ? "✗ " : ""}
                {STATUS[r.status].label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">No M-PESA messages with a balance were found.</p>}
      {forged.map((r, i) => (
        <p key={i} className="bad">
          <strong>{r.code}:</strong> {r.reason}
        </p>
      ))}
    </div>
  );
}

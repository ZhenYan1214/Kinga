// The user's M-PESA history as a balance chain: every genuine message must follow from the one before it.
import { useEffect, useState } from "react";
import { api, type LedgerRow } from "./api";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS: Record<LedgerRow["status"], { label: string; className: string }> = {
  fits: { label: "fits", className: "ok" },
  contradicts: { label: "never happened", className: "bad" },
  does_not_fit: { label: "does not follow", className: "warn-text" },
  unverifiable: { label: "start of history", className: "muted" },
};

const KIND: Record<string, string> = { received: "Received from", sent: "Sent to", paybill: "Paybill", till: "Paid to", withdraw: "Withdrawn at", unknown: "Other" };

export function Ledger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  useEffect(() => {
    api.ledger().then(setRows, () => undefined);
  }, []);
  const forged = rows.filter((r) => r.status === "contradicts");

  return (
    <div className="card ledger">
      <h3>Your M-PESA ledger</h3>
      <p className="muted small">
        Every M-PESA confirmation states your new balance, so each one must follow from the one before it. A forged message cannot know your real
        balance, and the real messages around it still add up without it.
      </p>
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
      {forged.map((r, i) => (
        <p key={i} className="bad">
          <strong>{r.code}:</strong> {r.reason}
        </p>
      ))}
    </div>
  );
}

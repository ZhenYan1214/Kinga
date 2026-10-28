// "Did they really pay?": the on-device vision model reads a payment screenshot; the user's own M-PESA
// ledger decides whether that money actually arrived.
import { useEffect, useState } from "react";
import { api, type Order, type VerifyResult } from "./api";

type Source = { kind: "demo"; order: Order } | { kind: "upload"; name: string; dataUrl: string };

const ksh = (n?: number) => (n === undefined ? "?" : `Ksh${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

function verdictOf(result: VerifyResult): { tone: "yes" | "no" | "warn"; title: string } {
  const { check, screenshot } = result;
  if (check.ok) {
    return { tone: "yes", title: `Yes. ${ksh(check.receipt?.amount)} from ${check.receipt?.counterparty} is in your M-PESA.` };
  }
  const codes = check.issues.map((i) => i.code);
  if (codes.includes("FORGED_IN_INBOX") || codes.includes("CODE_NOT_IN_INBOX") || codes.includes("NO_RECEIPT")) {
    return { tone: "no", title: `No. Transaction ${screenshot.fields.transaction_code} never reached your M-PESA.` };
  }
  if (codes.includes("NAME_MISMATCH")) {
    return { tone: "warn", title: `The money arrived, but from ${check.receipt?.counterparty}, not from your buyer.` };
  }
  if (codes.includes("CODE_ALREADY_USED")) return { tone: "warn", title: "This payment was already used for an earlier release." };
  return { tone: "warn", title: "The payment does not match what you expected." };
}

export function Verify({ orders }: { orders: Order[] }) {
  const [source, setSource] = useState<Source>();
  const [result, setResult] = useState<VerifyResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [amount, setAmount] = useState("");
  const [buyer, setBuyer] = useState("");

  useEffect(() => {
    if (!source && orders[0]) setSource({ kind: "demo", order: orders[0] });
  }, [orders, source]);

  async function check(next: Source) {
    setSource(next);
    setResult(undefined);
    setError(undefined);
    setBusy(true);
    try {
      setResult(
        await api.verify(
          next.kind === "demo"
            ? { orderId: next.order.id }
            : { image: next.dataUrl, amountKsh: Number(amount) || undefined, buyerName: buyer || undefined },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void check({ kind: "upload", name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  const image = source?.kind === "demo" ? `/api/screenshots/${source.order.screenshot}` : source?.dataUrl;
  const verdict = result && verdictOf(result);
  const misread = result?.check.receipt?.amount !== undefined && result.check.receipt.amount !== result.screenshot.fields.amount;

  return (
    <div className="verify">
      <section className="card pickers">
        <h3>Someone says they paid you</h3>
        <p className="muted small">Pick the screenshot a buyer sent, or upload one. It is read on this device and checked against your own M-PESA messages.</p>
        <div className="thumbs">
          {orders.map((o) => (
            <button key={o.id} className={`thumb ${source?.kind === "demo" && source.order.id === o.id ? "active" : ""}`} onClick={() => check({ kind: "demo", order: o })}>
              <img src={`/api/screenshots/${o.screenshot}`} alt={`Payment screenshot from ${o.buyerKycName}`} />
              <span>{o.buyerKycName}</span>
              <span className="muted small">expects Ksh{o.amountKsh.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <details className="upload">
          <summary>Upload your own screenshot</summary>
          <div className="form">
            <input placeholder="Amount you expect (Ksh), optional" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
            <input placeholder="Buyer's name, optional" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </details>
      </section>

      <section className="result-col">
        {image && (
          <div className="card shot">
            <img src={image} alt="The payment screenshot being checked" />
          </div>
        )}
        {busy && <div className="card muted">Reading the screenshot on this device, then checking your M-PESA ledger…</div>}
        {error && <div className="card bad">{error}</div>}
        {result && verdict && (
          <>
            <div className={`card banner tone-${verdict.tone}`}>
              <strong>{verdict.title}</strong>
              {result.check.issues.length > 0 && (
                <ul>
                  {result.check.issues
                    .filter((i, n, all) => !(i.code === "CODE_NOT_IN_INBOX" && all.some((j) => j.code === "FORGED_IN_INBOX")))
                    .map((i, n) => (
                      <li key={n}>{i.reason}</li>
                    ))}
                </ul>
              )}
              {result.check.ok && (
                <p className="small">
                  Matched {result.check.receipt?.code} in your inbox, from MPESA, and its balance fits your history.
                </p>
              )}
            </div>
            <div className="card">
              <h4>What the on-device model read ({(result.screenshot.ms / 1000).toFixed(1)} s)</h4>
              <dl className="fields">
                <dt>Transaction code</dt>
                <dd className="mono">{result.screenshot.fields.transaction_code || "not visible"}</dd>
                <dt>Amount</dt>
                <dd>{ksh(result.screenshot.fields.amount)}</dd>
                <dt>Paid to</dt>
                <dd>{result.screenshot.fields.counterparty || "not visible"}</dd>
                <dt>When</dt>
                <dd>
                  {result.screenshot.fields.date} {result.screenshot.fields.time}
                </dd>
              </dl>
              {misread && (
                <p className="small warn-text">
                  The screenshot shows {ksh(result.screenshot.fields.amount)}, but your M-PESA records {ksh(result.check.receipt?.amount)} for this code. Your M-PESA is
                  what counts.
                </p>
              )}
              <p className="footnote">The model only reads the picture. Whether the money is real is decided by your own M-PESA messages, never by the model.</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

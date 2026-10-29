// "Did they really pay?": the on-device vision model reads a payment proof; the user's own M-PESA messages
// decide whether that money arrived, for how much, and from whom.
import { useEffect, useState } from "react";
import { api, type DemoClaim, type InboxSource, type VerifyResult } from "./api";

type Source = { kind: "demo"; claim: DemoClaim } | { kind: "upload"; name: string; dataUrl: string };
type Tone = "yes" | "no" | "wait" | "warn";

const ksh = (n?: number) => (n === undefined ? "?" : `Ksh${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** One headline per outcome, in English and in fixed Kiswahili wording (never model output). */
function verdictOf(result: VerifyResult): { tone: Tone; en: string; sw: string } {
  const { check, screenshot } = result;
  const code = screenshot.fields.transaction_code;
  if (check.ok) {
    return {
      tone: "yes",
      en: `Yes. ${ksh(check.receipt?.amount)} from ${check.receipt?.counterparty} is in your M-PESA.`,
      sw: `Ndiyo. ${ksh(check.receipt?.amount)} kutoka kwa ${check.receipt?.counterparty} ziko kwenye M-PESA yako.`,
    };
  }
  const has = (c: string) => check.issues.some((i) => i.code === c);
  if (has("FORGED_IN_INBOX")) return { tone: "no", en: "Fake. This payment never reached your M-PESA.", sw: "Feki. Pesa hii haikuwahi kufika kwenye M-PESA yako." };
  if (has("AMOUNT_MISMATCH")) {
    return {
      tone: "no",
      en: `Edited proof. Transaction ${check.receipt?.code} is real, but it was for ${ksh(check.receipt?.amount)}.`,
      sw: `Ushahidi umebadilishwa. Muamala ${check.receipt?.code} ni wa kweli, lakini ulikuwa ${ksh(check.receipt?.amount)}.`,
    };
  }
  if (has("CODE_NOT_IN_INBOX") || has("NO_RECEIPT")) {
    return { tone: "wait", en: `Not in your M-PESA yet (${code}).`, sw: `Bado haijaonekana kwenye M-PESA yako (${code}).` };
  }
  if (has("NAME_MISMATCH")) {
    return {
      tone: "warn",
      en: `The money arrived, but from ${check.receipt?.counterparty}, not from the person who claims to have paid.`,
      sw: `Pesa imefika, lakini kutoka kwa ${check.receipt?.counterparty}, si kwa aliyesema amelipa.`,
    };
  }
  return { tone: "warn", en: "This payment was already used for an earlier release.", sw: "Malipo haya tayari yametumika." };
}

const T = {
  en: {
    pick: "Pick the proof someone showed you, or upload a screenshot. It is read on this device and matched against your own M-PESA messages.",
    upload: "Upload a screenshot",
    reading: "Reading the screenshot on this device, then checking your M-PESA messages…",
    read: "What the on-device model read",
    model: "The model only reads the picture. Whether the money is real is decided by your own M-PESA messages, never by the model.",
    reversal: "A real payment can still be reversed if the payer asks Safaricom. For large amounts, wait a little before handing over.",
    matched: (code?: string) => `Matched ${code} in your inbox: from MPESA, the right amount, and its balance fits your history.`,
    toggle: "Kiswahili",
  },
  sw: {
    pick: "Chagua ushahidi uliotumiwa, au pakia picha ya skrini. Inasomwa kwenye kifaa hiki na kulinganishwa na jumbe zako za M-PESA.",
    upload: "Pakia picha ya skrini",
    reading: "Inasoma picha kwenye kifaa hiki, kisha inaangalia jumbe zako za M-PESA…",
    read: "Modeli iliyo kwenye kifaa ilisoma",
    model: "Modeli inasoma picha tu. Kama pesa ni ya kweli huamuliwa na jumbe zako za M-PESA, si na modeli.",
    reversal: "Malipo ya kweli bado yanaweza kurudishwa mlipaji akiomba Safaricom. Kwa kiasi kikubwa, subiri kidogo kabla ya kutoa bidhaa.",
    matched: (code?: string) => `${code} imepatikana kwenye jumbe zako: kutoka MPESA, kiasi sahihi, na salio linalingana na historia yako.`,
    toggle: "English",
  },
};

export function Verify({ inboxSource }: { inboxSource?: InboxSource }) {
  const [claims, setClaims] = useState<DemoClaim[]>([]);
  const [source, setSource] = useState<Source>();
  const [result, setResult] = useState<VerifyResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState("");
  const [sw, setSw] = useState(false);
  const t = T[sw ? "sw" : "en"];

  useEffect(() => {
    api.claims().then(setClaims, () => undefined);
  }, []);

  async function check(next: Source) {
    setSource(next);
    setResult(undefined);
    setError(undefined);
    setBusy(true);
    try {
      setResult(
        await api.verify(
          next.kind === "demo"
            ? { claimId: next.claim.id }
            : { image: next.dataUrl, amountKsh: Number(amount) || undefined, buyerName: payer || undefined },
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

  const image = source?.kind === "demo" ? `/api/screenshots/${source.claim.screenshot}` : source?.dataUrl;
  const verdict = result && verdictOf(result);
  const shownIssues = result?.check.issues.filter((i, _n, all) => !(i.code === "CODE_NOT_IN_INBOX" && all.some((j) => j.code === "FORGED_IN_INBOX"))) ?? [];

  return (
    <div className="verify">
      <section className="card pickers">
        <div className="row">
          <h3>Someone says they paid you</h3>
          <button className="ghost lang" onClick={() => setSw(!sw)}>
            {t.toggle}
          </button>
        </div>
        <p className="muted small">{t.pick}</p>
        {inboxSource?.source === "imported" && (
          <p className="small warn-text">Checking against your imported M-PESA messages; the demo proofs below belong to the demo inbox.</p>
        )}
        <div className="thumbs">
          {claims.map((c) => (
            <button key={c.id} className={`thumb ${source?.kind === "demo" && source.claim.id === c.id ? "active" : ""}`} onClick={() => check({ kind: "demo", claim: c })}>
              <img src={`/api/screenshots/${c.screenshot}`} alt={`Payment proof from ${c.payerName}`} />
              <span>{c.who}</span>
              <span className="muted small">expects Ksh{c.expectsKsh.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <details className="upload">
          <summary>{t.upload}</summary>
          <div className="form">
            <input placeholder="Amount you expect (Ksh), optional" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
            <input placeholder="Name of the person who says they paid, optional" value={payer} onChange={(e) => setPayer(e.target.value)} />
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </details>
      </section>

      <section className="result-col">
        {image && (
          <div className="card shot">
            <img src={image} alt="The payment proof being checked" />
          </div>
        )}
        {busy && <div className="card muted">{t.reading}</div>}
        {error && <div className="card bad">{error}</div>}
        {result && verdict && (
          <>
            <div className={`card banner tone-${verdict.tone}`}>
              <strong>{sw ? verdict.sw : verdict.en}</strong>
              {shownIssues.length > 0 && (
                <ul>
                  {shownIssues.map((i, n) => (
                    <li key={n}>{sw ? i.reasonSw : i.reason}</li>
                  ))}
                </ul>
              )}
              {result.check.ok && (
                <>
                  <p className="small">{t.matched(result.check.receipt?.code)}</p>
                  <p className="small muted">{t.reversal}</p>
                </>
              )}
            </div>
            <div className="card">
              <h4>
                {t.read} ({(result.screenshot.ms / 1000).toFixed(1)} s)
              </h4>
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
              <p className="footnote">{t.model}</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

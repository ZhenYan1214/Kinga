// "Did they really pay?": the on-device vision model reads a payment proof; the user's own M-PESA messages
// decide whether that money arrived, for how much, and from whom.
import { useEffect, useState } from "react";
import { api, type DemoClaim, type InboxSource, type VerifyResult } from "./api";

type Source = { kind: "demo"; claim: DemoClaim } | { kind: "upload"; name: string; dataUrl: string };
type Tone = "yes" | "no" | "wait" | "warn";

const ksh = (n?: number) => (n === undefined ? "?" : `Ksh${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const DAY = 24 * 60;
const ago = (minutes: number) => {
  const days = Math.floor(minutes / DAY);
  return { en: days === 1 ? "a day" : `${days} days`, sw: days === 1 ? "siku moja" : `siku ${days}` };
};

/** One headline per outcome, in English and in fixed Kiswahili wording (never model output). */
function verdictOf(result: VerifyResult): { tone: Tone; en: string; sw: string } {
  const { check, screenshot } = result;
  const code = result.code;
  const real = ksh(check.receipt?.amount);
  if (check.ok && (check.receiptAgeMinutes ?? 0) > DAY) {
    // Safaricom's "old M-PESA message" fraud: a genuine payment from before, shown again for something new.
    const age = ago(check.receiptAgeMinutes!);
    return {
      tone: "warn",
      en: `Real, but old. ${real} from ${check.receipt?.counterparty} arrived ${age.en} before your latest M-PESA message. If this is for something new, an old payment is being shown again.`,
      sw: `Ni ya kweli, lakini ya zamani. ${real} kutoka kwa ${check.receipt?.counterparty} ziliingia ${age.sw} kabla ya ujumbe wako wa mwisho wa M-PESA. Kama ni kwa jambo jipya, malipo ya zamani yanaonyeshwa tena.`,
    };
  }
  if (check.ok) {
    return {
      tone: "yes",
      en: `Yes. ${real} from ${check.receipt?.counterparty} is in your M-PESA.`,
      sw: `Ndiyo. ${real} kutoka kwa ${check.receipt?.counterparty} ziko kwenye M-PESA yako.`,
    };
  }
  const has = (c: string) => check.issues.some((i) => i.code === c);
  if (has("FORGED_IN_INBOX")) return { tone: "no", en: "Fake. This payment never reached your M-PESA.", sw: "Feki. Pesa hii haikuwahi kufika kwenye M-PESA yako." };
  if (has("BALANCE_SAYS_FAKE")) {
    return {
      tone: "no",
      en: "Almost certainly fake. Your balances add up without this payment.",
      sw: "Karibu hakika ni feki. Salio zako zinalingana bila malipo haya.",
    };
  }
  if (has("BALANCE_GAP")) {
    return {
      tone: "wait",
      en: `Found ${code}, but your balance does not follow. Check *334# before handing anything over.`,
      sw: `${code} imepatikana, lakini salio halifuatani. Angalia *334# kabla ya kutoa chochote.`,
    };
  }
  if (has("AMOUNT_MISMATCH")) {
    const shown = screenshot.fields.amount;
    const expected = result.expectedKsh;
    if (result.amountFrom !== "screenshot" && shown !== undefined && shown === check.receipt?.amount) {
      // The picture and M-PESA agree; it is only less than expected. That is underpaying, not editing.
      return {
        tone: "warn",
        en: `Underpaid. ${check.receipt?.code} is real and the proof shows it honestly: ${real}, not the ${ksh(expected)} you expected.`,
        sw: `Amelipa pungufu. ${check.receipt?.code} ni ya kweli na ushahidi unaonyesha ukweli: ${real}, si ${ksh(expected)} ulizotarajia.`,
      };
    }
    if (result.amountFrom !== "screenshot" && shown !== undefined && shown === expected) {
      // Two independent numbers agree against M-PESA: what you were promised and what the picture says.
      return {
        tone: "no",
        en: `Edited proof. Transaction ${check.receipt?.code} is real, but it was for ${real}, not the ${ksh(shown)} on the proof.`,
        sw: `Ushahidi umebadilishwa. Muamala ${check.receipt?.code} ni wa kweli, lakini ulikuwa ${real}, si ${ksh(shown)} zilizo kwenye ushahidi.`,
      };
    }
    // Otherwise the only other number may be a misread: let the person compare the picture.
    const read = ksh(shown);
    return {
      tone: "warn",
      en: `Check the amount. Your M-PESA shows ${real} for ${check.receipt?.code}; the model read ${read} on the screenshot. Compare the picture yourself: if it says ${read}, it was edited.`,
      sw: `Angalia kiasi. M-PESA yako inaonyesha ${real} kwa ${check.receipt?.code}; modeli ilisoma ${read} kwenye picha. Linganisha picha mwenyewe: ikionyesha ${read}, imebadilishwa.`,
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
    reversal: "Safaricom asks you before reversing a payment: if they call about this one, decline unless it really was sent by mistake.",
    matched: (code?: string) => `Matched ${code} in your inbox: from MPESA, the right amount, and nothing in your balance history contradicts it.`,
    arrived: (when: string) => `It arrived on ${when}.`,
    seen: (time: string) => `You already checked this transaction at ${time}. Make sure it is not being used twice.`,
    codeHint: "Transaction code, if the picture is unclear",
    again: "Check again",
    toggle: "Kiswahili",
  },
  sw: {
    pick: "Chagua ushahidi uliotumiwa, au pakia picha ya skrini. Inasomwa kwenye kifaa hiki na kulinganishwa na jumbe zako za M-PESA.",
    upload: "Pakia picha ya skrini",
    reading: "Inasoma picha kwenye kifaa hiki, kisha inaangalia jumbe zako za M-PESA…",
    read: "Modeli iliyo kwenye kifaa ilisoma",
    model: "Modeli inasoma picha tu. Kama pesa ni ya kweli huamuliwa na jumbe zako za M-PESA, si na modeli.",
    reversal: "Safaricom hukuuliza kabla ya kurudisha malipo: wakikupigia kuhusu haya, kataa isipokuwa kweli yalitumwa kimakosa.",
    matched: (code?: string) => `${code} imepatikana kwenye jumbe zako: kutoka MPESA, kiasi sahihi, na hakuna kwenye historia ya salio kinachopingana nayo.`,
    arrived: (when: string) => `Iliingia tarehe ${when}.`,
    seen: (time: string) => `Tayari uliangalia muamala huu saa ${time}. Hakikisha hautumiki mara mbili.`,
    codeHint: "Code ya muamala, kama picha haionekani vizuri",
    again: "Angalia tena",
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
  const [code, setCode] = useState("");
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
            : { image: next.dataUrl, amountKsh: Number(amount) || undefined, buyerName: payer || undefined, code: code || undefined },
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
  const when = result?.check.receipt;
  const arrival = when?.date && `${when.date.day}/${when.date.month}/${when.date.year}${when.time ? ` ${when.time}` : ""}`;
  const shownIssues =
    result?.check.issues.filter(
      (i, _n, all) =>
        !(i.code === "CODE_NOT_IN_INBOX" && all.some((j) => j.code === "FORGED_IN_INBOX")) &&
        // The headline compares the amounts itself; the core reason assumes the proof showed the expected amount.
        i.code !== "AMOUNT_MISMATCH",
    ) ?? [];

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
            <input placeholder="Amount you expect (Ksh), recommended" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
            <input placeholder="Name of the person who says they paid, optional" value={payer} onChange={(e) => setPayer(e.target.value)} />
            <input placeholder={t.codeHint} className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = ""; // so picking the same file again checks it again
              }}
            />
            {source?.kind === "upload" && (
              <button disabled={busy} onClick={() => void check(source)}>
                {t.again}
              </button>
            )}
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
                  <p className="small">
                    {t.matched(result.check.receipt?.code)} {arrival && t.arrived(arrival)}
                  </p>
                  <p className="small muted">{t.reversal}</p>
                </>
              )}
              {result.firstCheckedAt && <p className="small">{t.seen(new Date(result.firstCheckedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}</p>}
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

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { analyze, checkRelease, claimedAmount, MpesaLedger, type Message } from "../src/index.js";

const mpesa = (text: string): Message => ({ channel: "sms", sender: "MPESA", text });
const sms = (sender: string, text: string): Message => ({ channel: "sms", sender, text });

const G1 = mpesa("UJ7K1PL5RT Confirmed. Ksh1,500.00 sent to JANE WAMBUI 0723***901 on 27/10/26 at 7:40 PM. New M-PESA balance is Ksh11,730.00. Transaction cost, Ksh23.00.");
const G2 = mpesa("UJ7M2QK8TA Confirmed.You have received Ksh6,500.00 from BRIAN OUMA 0712***408 on 28/10/26 at 4:12 PM New M-PESA balance is Ksh18,230.00.");
const G3 = mpesa("UJ7N4RD2WB Confirmed.You have received Ksh9,750.00 from PETER NJOROGE 0790***115 on 28/10/26 at 5:03 PM New M-PESA balance is Ksh27,980.00.");
const G4 = mpesa("UJ7Q2TM4HX Confirmed. Ksh450.00 paid to NAIVAS MOI AVENUE. on 28/10/26 at 6:10 PM.New M-PESA balance is Ksh27,530.00. Transaction cost, Ksh0.00.");
const CHAIN = [G1, G2, G3, G4];

/** A forgery with a perfect template and the real sender ID: only the balance can give it away. */
const forged = (balance: string, time = "5:20 PM") =>
  mpesa(`UJ7P9XK3LC Confirmed.You have received Ksh13,000.00 from KEVIN MUTUA 0745***112 on 28/10/26 at ${time} New M-PESA balance is Ksh${balance}.`);

describe("MpesaLedger", () => {
  it("accepts every genuine message in a consistent chain", () => {
    const ledger = new MpesaLedger(CHAIN);
    assert.equal(ledger.entries.length, 4);
    for (const m of [G2, G3, G4]) assert.equal(ledger.check(m).status, "fits", m.text);
  });

  it("proves a template-perfect forgery never happened, even if the forger knew the balance", () => {
    for (const balance of ["41,230.00", "40,980.00"]) {
      const fake = forged(balance);
      const ledger = new MpesaLedger([...CHAIN.slice(0, 3), fake, G4]);
      const check = ledger.check(fake);
      assert.equal(check.status, "contradicts", balance);
      assert.match(check.reason, /add up without it/);
    }
  });

  it("orders by the receipts' own dates, whatever order the inbox is in", () => {
    const fake = forged("41,230.00");
    const shuffled = [G3, fake, G1, G4, G2];
    const ledger = new MpesaLedger(shuffled);
    for (const m of [G2, G3, G4]) assert.equal(ledger.check(m).status, "fits", m.text);
    assert.equal(ledger.check(fake).status, "contradicts");
  });

  it("only says does_not_fit when nothing comes after the forgery yet", () => {
    const fake = forged("41,230.00", "6:30 PM");
    assert.equal(new MpesaLedger([...CHAIN, fake]).check(fake).status, "does_not_fit");
  });

  it("treats a missing message as a gap, not a forgery", () => {
    const ledger = new MpesaLedger([G1, G3, G4]); // G2 was deleted
    assert.equal(ledger.check(G3).status, "does_not_fit");
    // Money coming in that does not fit gets "check your balance", never "scam"; money going out stays safe.
    assert.equal(analyze(G3, { ledger }).level, "suspicious");
    const outgoingGap = new MpesaLedger([G1, G2, G4]); // G3 was deleted
    assert.equal(outgoingGap.check(G4).status, "does_not_fit");
    assert.equal(analyze(G4, { ledger: outgoingGap }).level, "safe");
  });

  it("restarts the chain after a template it does not model, such as a Fuliza repayment", () => {
    const fuliza = mpesa("UJ7R8WQ1ZA Confirmed. Ksh2,000.00 from your M-PESA has been used to fully pay your outstanding Fuliza M-PESA. M-PESA balance is Ksh25,980.00.");
    const after = mpesa("UJ7S3LM9KD Confirmed. Ksh450.00 paid to NAIVAS MOI AVENUE. on 28/10/26 at 6:10 PM.New M-PESA balance is Ksh25,530.00. Transaction cost, Ksh0.00.");
    assert.equal(new MpesaLedger([G1, G2, G3, fuliza, after]).check(after).status, "fits");
  });
});

describe("analyze with a ledger", () => {
  const ledger = new MpesaLedger(CHAIN);

  it("calls a spoofed MPESA receipt a scam when the chain contradicts it", () => {
    const fake = forged("41,230.00");
    assert.equal(analyze(fake).level, "safe"); // the text alone looks perfect
    const withLedger = analyze(fake, { ledger: new MpesaLedger([...CHAIN.slice(0, 3), fake, G4]) });
    assert.equal(withLedger.level, "scam");
    assert.ok(withLedger.signals.some((s) => s.id === "S5" && s.strength === "hard"));
    assert.equal(withLedger.verifiedReceipt, false);
  });

  it("proves a 'sent by mistake' refund request is fake when the money never arrived", () => {
    const ask = sms("0712300455", "Pole sana, nimetuma 2,000 kimakosa kwa namba yako. Tafadhali nirudishie.");
    const v = analyze(ask, { ledger });
    assert.equal(v.level, "scam");
    assert.match(v.signals.find((s) => s.id === "S5")!.reason, /Ksh2,000/);
    // If a real 6,500 did arrive, the ledger stays quiet (the advice still says: reverse only through 456).
    const real = sms("0712300455", "Nimetuma 6,500 kimakosa, tafadhali nirudishie");
    assert.ok(!analyze(real, { ledger }).signals.some((s) => s.id === "S5"));
  });

  it("reads amounts out of free text", () => {
    assert.equal(claimedAmount("nimetuma 2,000 kimakosa"), 2000);
    assert.equal(claimedAmount("sent you Ksh1500 by mistake, call 0712345678"), 1500);
    assert.equal(claimedAmount("nisort na 3k"), 3000);
    assert.equal(claimedAmount("call me on 0712345678"), undefined);
  });
});

describe("checkRelease with a ledger", () => {
  it("rejects a claimed code whose MPESA-looking message breaks the balance chain", () => {
    const fake = forged("41,230.00");
    const r = checkRelease({ amountKsh: 13000, buyerKycName: "Kevin Mutua", claimedCode: "UJ7P9XK3LC" }, [...CHAIN.slice(0, 3), fake, G4]);
    assert.equal(r.ok, false);
    assert.equal(r.issues[0]!.code, "FORGED_IN_INBOX");
    assert.match(r.issues[0]!.reason, /never entered your account/);
  });
});

describe("edited proofs and late messages", () => {
  const RENT = mpesa("UJ6R4TG8NP Confirmed.You have received Ksh20.00 from GRACE MUTHONI 0711***902 on 27/10/26 at 9:10 AM New M-PESA balance is Ksh13,253.00.");

  it("catches a real transaction code shown with an edited amount", () => {
    const r = checkRelease({ amountKsh: 20000, buyerKycName: "Grace Muthoni", claimedCode: "UJ6R4TG8NP" }, [RENT, G1]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.issues.map((i) => i.code), ["AMOUNT_MISMATCH"]);
    assert.match(r.issues[0]!.reason, /Ksh20\.00, not the Ksh20,000\.00 expected.*edited/);
    assert.match(r.issues[0]!.reasonSw, /umebadilishwa/);
  });

  it("says 'not yet' rather than 'fake' when a code has not arrived", () => {
    const r = checkRelease({ amountKsh: 5000, claimedCode: "UJ9Z9Z9Z9Z" }, CHAIN);
    assert.equal(r.issues[0]!.code, "CODE_NOT_IN_INBOX");
    assert.match(r.issues[0]!.reason, /yet.*a few minutes late/);
  });
});

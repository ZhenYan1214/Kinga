import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { analyze, checkAddress, checkRelease, fuse, namesMatch, parseMpesaReceipt, type Message } from "../src/index.js";

const sms = (sender: string, text: string, contact: string | null = null): Message => ({ channel: "sms", sender, contact, text });
const ids = (m: Message) => analyze(m).signals.map((s) => s.id);

const GENUINE_RECEIVED =
  "UJ81KQ2ZT4 Confirmed.You have received Ksh3,500.00 from JOHN KAMAU 0798***432 on 27/10/26 at 6:14 PM New M-PESA balance is Ksh12,050.00. Separate personal and business funds through Pochi la Biashara on *334#.";
const GENUINE_SENT =
  "UJ84HD71PL Confirmed. Ksh1,200.00 sent to MARY WANJIKU 0722***000 on 27/10/26 at 9:02 AM. New M-PESA balance is Ksh8,431.50. Transaction cost, Ksh15.00. Amount you can transact within the day is 498,800.00.";

describe("M-PESA receipt parsing", () => {
  it("parses a received confirmation", () => {
    const r = parseMpesaReceipt(GENUINE_RECEIVED);
    assert.equal(r.kind, "received");
    assert.equal(r.code, "UJ81KQ2ZT4");
    assert.equal(r.amount, 3500);
    assert.equal(r.counterparty, "JOHN KAMAU");
    assert.equal(r.counterpartyNumber, "0798***432");
    assert.deepEqual(r.date, { day: 27, month: 10, year: 2026 });
    assert.equal(r.balance, "Ksh12,050.00");
  });

  it("parses sent, paybill, till and withdraw", () => {
    assert.equal(parseMpesaReceipt(GENUINE_SENT).cost, 15);
    const paybill = parseMpesaReceipt(
      "UJ29XK3M1B Confirmed. Ksh2,000.00 sent to KPLC PREPAID for account 37144556677 on 2/10/26 at 7:45 PM New M-PESA balance is Ksh5,120.00. Transaction cost, Ksh0.00.",
    );
    assert.equal(paybill.kind, "paybill");
    assert.equal(paybill.account, "37144556677");
    const till = parseMpesaReceipt(
      "UJ3P0LM8QA Confirmed. Ksh450.00 paid to NAIVAS MOI AVENUE. on 3/10/26 at 1:15 PM.New M-PESA balance is Ksh4,670.00. Transaction cost, Ksh0.00.",
    );
    assert.equal(till.kind, "till");
    assert.equal(till.counterparty, "NAIVAS MOI AVENUE");
    const withdraw = parseMpesaReceipt(
      "UJ5T2WQ9RE Confirmed.on 5/10/26 at 10:02 AMWithdraw Ksh1,000.00 from 123456 - MAMA NJERI SHOP New M-PESA balance is Ksh3,600.00. Transaction cost, Ksh29.00.",
    );
    assert.equal(withdraw.kind, "withdraw");
    assert.equal(withdraw.amount, 1000);
  });
});

describe("analyze", () => {
  it("passes genuine receipts from MPESA", () => {
    for (const text of [GENUINE_RECEIVED, GENUINE_SENT]) {
      const v = analyze(sms("MPESA", text));
      assert.equal(v.level, "safe", JSON.stringify(v.signals));
      assert.equal(v.verifiedReceipt, true);
    }
  });

  it("calls a receipt from a personal number a scam", () => {
    const v = analyze(sms("0712345678", GENUINE_RECEIVED));
    assert.equal(v.level, "scam");
    assert.equal(v.category, "fake_mpesa_confirmation");
    assert.ok(ids(sms("0712345678", GENUINE_RECEIVED)).includes("S1"));
  });

  it("flags LOCKED balances, bad codes, KES amounts and unmasked numbers", () => {
    const forged = sms(
      "MPESA",
      "uj81kq2zt Confirmed. You have received KES 3500 from JOHN KAMAU 0798765432 on 27/10/26 at 6:14 PM New M-PESA balance is *LOCKED*",
    );
    assert.deepEqual(new Set(ids(forged)), new Set(["S2", "S6", "S7", "S8"]));
    assert.equal(analyze(forged).level, "scam");
  });

  it("does not expect masking before 24 March 2026", () => {
    const old = sms(
      "MPESA",
      "TB81KQ2ZT4 Confirmed.You have received Ksh3,500.00 from JOHN KAMAU 0798765432 on 12/2/26 at 6:14 PM New M-PESA balance is Ksh12,050.00.",
    );
    assert.ok(!ids(old).includes("S8"));
  });

  it("catches the wrong-send reversal follow-up", () => {
    const v = analyze(sms("0712345678", "Sorry bro nimekosea kutuma, hiyo ni pesa ya karo. Tafadhali nirudishie 3,500 kwa hii namba haraka"));
    assert.ok(v.signals.some((s) => s.id === "S3"));
    assert.equal(v.category, "wrong_send_reversal");
    assert.notEqual(v.level, "safe");
  });

  it("treats a PIN request as a scam but not a bank's do-not-share OTP", () => {
    const phish = analyze(
      sms("0733000111", "Safaricom: Your line has been registered twice and will be suspended in 2 hours. Call this number and confirm your M-PESA PIN to keep your line active."),
    );
    assert.equal(phish.level, "scam");
    assert.ok(phish.signals.some((s) => s.id === "S12"));
    const otp = analyze(sms("KCB", "Your KCB verification code is 482913. Do not share this code with anyone. KCB will never ask for it."));
    assert.equal(otp.level, "safe");
  });

  it("flags payment redirection from an unknown number but not from a saved contact", () => {
    const text = "Ile pesa ya rent usitume kwa ile paybill ya zamani, tuma kwa hii namba 0711222333 jina ni Mary W. - Landlord";
    assert.notEqual(analyze(sms("0711222333", text)).level, "safe");
    assert.ok(!ids(sms("0711222333", text, "Landlord Mary")).includes("S15"));
  });

  it("reads the Swahili template and catches its forgeries", () => {
    const text =
      "UJ2K7PLQ4M Imethibitishwa. Umepokea Ksh2,500.00 kutoka kwa ALICE MUTHONI 0711***205 tarehe 26/10/26 saa 3:10 PM. Salio jipya la M-PESA ni Ksh6,140.00.";
    assert.equal(parseMpesaReceipt(text).amount, 2500);
    assert.equal(analyze(sms("MPESA", text)).level, "safe");
    assert.equal(analyze(sms("0711000205", text)).level, "scam");
  });

  it("leaves other registered senders' templates to them", () => {
    const shwari = sms("M-Shwari", "UJ6P2RKD8T Confirmed. Ksh500.00 transferred from M-Shwari account on 13/10/26 at 8:44 PM. M-Shwari balance is Ksh1,320.00.");
    assert.deepEqual(analyze(shwari).signals, []);
    const fuliza = sms("MPESA", "UJ3W8NDK5R Confirmed. Ksh300.00 from your M-PESA has been used to pay your outstanding Fuliza M-PESA. M-PESA balance is Ksh745.50.");
    assert.equal(analyze(fuliza).level, "safe");
  });

  it("flags 24-hour times and four-digit years in receipts", () => {
    const v = analyze(sms("MPESA", "UJ81KQ2ZT4 Confirmed. You have received Ksh3,500.00 from JOHN KAMAU 0798***432 on 27/10/2026 at 18:14 New M-PESA balance is Ksh12,050.00."));
    assert.ok(v.signals.some((s) => s.id === "S7"));
  });

  it("treats an agency header from a personal number as impersonation", () => {
    const v = analyze(sms("0711306829", "NTSA: Your driving licence is flagged. Pay Ksh2,000 correction fee to 0711306829 today to avoid arrest."));
    assert.deepEqual(new Set(v.signals.map((s) => s.id)), new Set(["S10", "S12", "S13", "S25"]));
  });

  it("leaves ordinary messages alone", () => {
    for (const m of [
      sms("0722555444", "Hi Mum, I'll be home late today, the matatu is stuck in traffic on Thika Road."),
      sms("0722555444", "Mama nitumie 500 ya fare tafadhali, nitakurudishia Friday", "Wanjiru"),
      sms("Safaricom", "Get 1GB for Ksh50 valid 24hrs. Dial *544# or visit safaricom.co.ke/bundles"),
    ]) {
      assert.equal(analyze(m).level, "safe", `${m.text} -> ${JSON.stringify(analyze(m).signals)}`);
    }
  });

  it("flags P2P release pressure and off-platform moves", () => {
    const v = analyze({
      channel: "p2p_chat",
      sender: "P2P buyer",
      text: "I have already paid via M-Pesa, check the screenshot. Please release the USDT now, I am in a hurry. Let's continue on WhatsApp it's faster.",
    });
    assert.deepEqual(new Set(v.signals.map((s) => s.id)), new Set(["S21", "S19", "S4"]));
    assert.equal(v.category, "p2p_payment_fraud");
    assert.equal(v.level, "high_risk");
  });

  it("flags fixed returns paid in USDT", () => {
    const v = analyze(sms("0799111222", "Join our AI trading bot, earn 5% daily guaranteed. Deposit USDT to TQ9x7fK2mPq4Rr8sT1uV3wX5yZ6aB7cD8e and invite 3 friends for bonus."));
    assert.equal(v.category, "investment_or_crypto");
    assert.equal(v.level, "high_risk");
  });
});

describe("fuse", () => {
  const benign = analyze(sms("0722555444", "Hi Mum, I'll be home late today."));
  it("lets the LLM raise but not lower the level", () => {
    const scam = analyze(sms("0712345678", GENUINE_RECEIVED));
    assert.equal(fuse(scam, { category: "not_scam", scam_likelihood: "low" }).level, "scam");
    const raised = fuse(benign, { category: "relative_impersonation", scam_likelihood: "high" });
    assert.equal(raised.level, "high_risk");
    assert.equal(raised.decidedBy, "llm");
    assert.equal(raised.category, "relative_impersonation");
  });

  it("does not let the LLM raise a verified receipt", () => {
    const genuine = analyze(sms("MPESA", GENUINE_SENT));
    assert.equal(fuse(genuine, { category: "fake_mpesa_confirmation", scam_likelihood: "high" }).level, "safe");
  });
});

describe("checkRelease", () => {
  const inbox = [sms("MPESA", GENUINE_RECEIVED), sms("0712345678", GENUINE_RECEIVED.replace("UJ81KQ2ZT4", "UJ99FAKE00"))];

  it("passes when a genuine receipt matches amount and buyer name", () => {
    const r = checkRelease({ amountKsh: 3500, buyerKycName: "John Mwangi Kamau" }, inbox);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it("blocks a code that only exists in a forged SMS", () => {
    const r = checkRelease({ amountKsh: 3500, buyerKycName: "John Kamau", claimedCode: "UJ99FAKE00" }, inbox);
    assert.equal(r.ok, false);
    assert.deepEqual(r.issues.map((i) => i.code), ["FORGED_IN_INBOX", "CODE_NOT_IN_INBOX"]);
  });

  it("blocks triangular fraud, wrong amounts and reused receipts", () => {
    assert.deepEqual(checkRelease({ amountKsh: 3500, buyerKycName: "Peter Otieno" }, inbox).issues.map((i) => i.code), ["NAME_MISMATCH"]);
    assert.deepEqual(checkRelease({ amountKsh: 5000, buyerKycName: "John Kamau" }, inbox).issues.map((i) => i.code), ["NO_RECEIPT"]);
    assert.deepEqual(
      checkRelease({ amountKsh: 3500, buyerKycName: "John Kamau" }, inbox, new Set(["UJ81KQ2ZT4"])).issues.map((i) => i.code),
      ["CODE_ALREADY_USED"],
    );
  });

  it("matches two shown names against a longer KYC name", () => {
    assert.ok(namesMatch("JOHN KAMAU", "John Mwangi Kamau"));
    assert.ok(!namesMatch("JOHN OTIENO", "John Mwangi Kamau"));
  });
});

describe("checkAddress", () => {
  const saved = [{ label: "My Binance TRC20", address: "TXk3pQ9mR7sV2wZ4yB6nC8dF1gH5jL7aQx" }];
  it("recognises saved, look-alike, wrong-network and invalid addresses", () => {
    assert.equal(checkAddress("TXk3pQ9mR7sV2wZ4yB6nC8dF1gH5jL7aQx", "tron", saved).kind, "saved");
    assert.equal(checkAddress("TXk3zz9mR7sV2wZ4yB6nC8dF1gH5jL7aQx".replace("zz", "ab"), "tron", saved).kind, "poisoning");
    assert.equal(checkAddress("0x" + "a".repeat(40), "tron", saved).kind, "wrong_network");
    assert.equal(checkAddress("not-an-address", "tron", saved).kind, "invalid");
  });
});

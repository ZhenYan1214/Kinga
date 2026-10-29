import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkRelease, MpesaLedger, parseSmsBackup } from "../src/index.js";

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<smses count="4">
  <sms protocol="0" address="MPESA" date="1793091000000" type="1" subject="null" body="UJ7N4RD2WB Confirmed.You have received Ksh9,750.00 from PETER NJOROGE 0790***115 on 28/10/26 at 5:03 PM New M-PESA balance is Ksh27,980.00." read="1" contact_name="(Unknown)" />
  <sms protocol="0" address="MPESA" date="1793082000000" type="1" subject="null" body="UJ7M2QK8TA Confirmed.You have received Ksh6,500.00 from BRIAN OUMA 0712***408 on 28/10/26 at 4:12 PM New M-PESA balance is Ksh18,230.00." read="1" contact_name="(Unknown)" />
  <sms protocol="0" address="0745903112" date="1793092000000" type="1" subject="null" body="UJ7P9XK3LC Confirmed. You have received Ksh13,000.00 from KEVIN MUTUA on 28/10/26 at 5:20 PM New M-PESA balance is *LOCKED*." read="1" contact_name="M-Pesa" />
  <sms protocol="0" address="0722410733" date="1793093000000" type="2" subject="null" body="Sawa mama &amp; asante" read="1" contact_name="Mum" />
</smses>`;

describe("parseSmsBackup", () => {
  it("keeps received messages, oldest first, with raw sender addresses and decoded text", () => {
    const sms = parseSmsBackup(XML);
    assert.equal(sms.length, 3); // the sent message (type 2) is skipped
    assert.deepEqual(sms.map((m) => m.sender), ["MPESA", "MPESA", "0745903112"]);
    assert.equal(sms[2]!.contact, "M-Pesa");
  });

  it("never treats a number saved as 'M-Pesa' as the real MPESA sender", () => {
    const inbox = parseSmsBackup(XML);
    assert.equal(new MpesaLedger(inbox).entries.length, 2);
    const r = checkRelease({ amountKsh: 13000, claimedCode: "UJ7P9XK3LC" }, inbox);
    assert.equal(r.issues[0]!.code, "FORGED_IN_INBOX");
  });

  it("rejects files that are not an SMS Backup & Restore export", () => {
    assert.throws(() => parseSmsBackup("<html></html>"), /SMS Backup & Restore/);
  });
});

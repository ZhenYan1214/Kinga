import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import WDK from "@tetherto/wdk";
import type { AddressVerdict, ReleaseCheck } from "@kinga/core";
import { decodeTransfer, encodeTransfer, formatUnits, KingaWallet, parseUnits, type ChainRpc } from "../src/index.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const usdt = (v: string) => parseUnits(v, 6);
const OK_RECEIPT: ReleaseCheck = { ok: true, issues: [] };
const saved = (address: string): AddressVerdict => ({ kind: "saved", contact: { label: "Buyer", address } });

class FakeRpc implements ChainRpc {
  sent: string[] = [];
  mode: "ok" | "offline" | "reject" = "ok";
  async pendingNonce() { return 7; }
  async feeQuote() { return { maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }; }
  async ethBalance() { return 10n ** 16n; }
  async tokenBalance() { return usdt("500"); }
  async sendRawTransaction(raw: string) {
    if (this.mode === "offline") throw new Error("eth_sendRawTransaction: no RPC endpoint reachable (fetch failed)");
    if (this.mode === "reject") throw new Error("eth_sendRawTransaction: insufficient funds");
    this.sent.push(raw);
    return `0x${"ab".repeat(32)}`;
  }
  async receiptStatus() { return "success" as const; }
}

async function openWallet(now = () => new Date("2026-10-29T10:00:00Z")) {
  const wallet = await KingaWallet.open(
    {
      seed: WDK.getRandomSeedPhrase(),
      chainId: 11155111,
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      perTransactionCap: usdt("200"),
      dailyBudget: usdt("300"),
      statePath: join(mkdtempSync(join(tmpdir(), "kinga-wallet-")), "state.json"),
    },
    now,
  );
  wallet.allow("Buyer", BUYER);
  return wallet;
}

const request = (amount: string, extra: Partial<Parameters<KingaWallet["release"]>[0]> = {}) => ({
  orderId: "order-1",
  mpesaCode: "UJ81KQ2ZT4",
  to: BUYER,
  amount: usdt(amount),
  receiptCheck: OK_RECEIPT,
  addressVerdict: saved(BUYER),
  humanApproved: true,
  ...extra,
});

describe("erc20", () => {
  it("round-trips transfer calldata and units", () => {
    const data = encodeTransfer(BUYER, usdt("12.5"));
    assert.deepEqual(decodeTransfer(data), { to: BUYER, amount: 12_500_000n });
    assert.equal(decodeTransfer("0xdeadbeef"), undefined);
    assert.equal(formatUnits(usdt("0.000001"), 6), "0.000001");
    assert.throws(() => parseUnits("1.0000001", 6));
  });
});

describe("release gate", () => {
  it("stops at each gate in order", async () => {
    const wallet = await openWallet();
    const receipt: ReleaseCheck = { ok: false, issues: [{ code: "NAME_MISMATCH", reason: "payer differs", reasonSw: "mlipaji ni tofauti" }] };
    assert.equal((await wallet.release(request("10", { receiptCheck: receipt }))) .ok, false);
    assert.deepEqual(await wallet.release(request("10", { receiptCheck: receipt })), { ok: false, stage: "receipt", reasons: ["payer differs"] });
    const poisoned: AddressVerdict = { kind: "poisoning", lookalike: { label: "Buyer", address: BUYER }, reason: "look-alike" };
    assert.deepEqual(await wallet.release(request("10", { addressVerdict: poisoned })), { ok: false, stage: "address", reasons: ["look-alike"] });
    assert.equal((await wallet.release(request("10", { humanApproved: false })) as { stage: string }).stage, "approval");
    assert.equal((await wallet.release(request("10")) as { stage: string }).stage, "network_snapshot");
    wallet.dispose();
  });

  it("signs offline after one snapshot, and the WDK policy enforces allowlist, cap and 24h budget", async () => {
    const wallet = await openWallet();
    await wallet.refreshSnapshot(new FakeRpc());

    // The address check says "saved" but the wallet never allowlisted it: WDK's policy still refuses.
    const stranger = await wallet.release(request("10", { to: STRANGER, addressVerdict: saved(STRANGER) }));
    assert.deepEqual(stranger, { ok: false, stage: "policy", reasons: ["The recipient is not on your saved address list."] });
    assert.match((await wallet.release(request("250")) as { reasons: string[] }).reasons[0]!, /single release may not exceed 200/);

    const first = await wallet.release(request("150"));
    assert.ok(first.ok);
    assert.match(first.record.raw, /^0x02/); // EIP-1559 transaction, signed with no provider
    assert.equal(first.record.nonce, 7);
    const second = await wallet.release(request("140", { orderId: "order-2", mpesaCode: "UJ81KQ2ZT5" }));
    assert.ok(second.ok);
    assert.equal(second.record.nonce, 8);
    assert.equal(wallet.spentLast24h(), usdt("290"));
    const third = await wallet.release(request("20", { orderId: "order-3", mpesaCode: "UJ81KQ2ZT6" }));
    assert.match((third as { reasons: string[] }).reasons[0]!, /last 24 hours may not exceed 300/);
    assert.deepEqual(wallet.usedMpesaCodes(), new Set(["UJ81KQ2ZT4", "UJ81KQ2ZT5"]));
    wallet.dispose();
  });

  it("frees the budget after 24 hours", async () => {
    let clock = new Date("2026-10-29T10:00:00Z");
    const wallet = await openWallet(() => clock);
    await wallet.refreshSnapshot(new FakeRpc());
    assert.ok((await wallet.release(request("200"))).ok);
    assert.equal((await wallet.release(request("200", { mpesaCode: "X2" }))).ok, false);
    clock = new Date("2026-10-30T10:00:01Z");
    assert.ok((await wallet.release(request("200", { mpesaCode: "X3" }))).ok);
    wallet.dispose();
  });

  it("previews the policy decision without signing", async () => {
    const wallet = await openWallet();
    await wallet.refreshSnapshot(new FakeRpc());
    assert.deepEqual(await wallet.preview(request("50")), { ok: true });
    assert.equal(((await wallet.preview(request("250"))) as { stage: string }).stage, "policy");
    assert.equal(wallet.releases.length, 0);
    wallet.dispose();
  });
});

describe("broadcast", () => {
  it("keeps releases queued while offline, sends them when online, and marks node rejections failed", async () => {
    const wallet = await openWallet();
    const rpc = new FakeRpc();
    await wallet.refreshSnapshot(rpc);
    await wallet.release(request("10"));

    rpc.mode = "offline";
    assert.deepEqual(await wallet.broadcastPending(rpc), []);
    assert.equal(wallet.releases[0]!.status, "signed");

    rpc.mode = "ok";
    const sent = await wallet.broadcastPending(rpc);
    assert.equal(sent.length, 1);
    assert.equal(rpc.sent[0], wallet.releases[0]!.raw);
    await wallet.confirmPending(rpc);
    assert.equal(wallet.releases[0]!.status, "confirmed");

    await wallet.release(request("10", { mpesaCode: "X2" }));
    rpc.mode = "reject";
    await wallet.broadcastPending(rpc);
    assert.equal(wallet.releases[1]!.status, "failed");
    assert.equal(wallet.spentLast24h(), usdt("10")); // a failed release does not use budget
    wallet.dispose();
  });
});

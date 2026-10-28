// D2 check of the release gate against live Sepolia: snapshot (network), sign a 1 USDT self-transfer (offline),
// and broadcast only with --broadcast and enough ETH for gas and USDT for the amount.
// npm run spike:wallet [-- --broadcast]
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkAddress, type ReleaseCheck } from "@kinga/core";
import { formatUnits, JsonRpc, KingaWallet, parseUnits } from "@kinga/wallet";

const SEPOLIA_RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"];
const { values } = parseArgs({ options: { broadcast: { type: "boolean", default: false } } });

if (existsSync(".env")) process.loadEnvFile(".env");
const seed = process.env.KINGA_TEST_SEED;
if (!seed) throw new Error("KINGA_TEST_SEED missing from .env; run npm run spike:wdk once to create a test seed");
const token = process.env.KINGA_USDT_ADDRESS;
if (!token) console.log("KINGA_USDT_ADDRESS not set in .env: token balance and broadcast are skipped");

const wallet = await KingaWallet.open({
  seed,
  chainId: 11155111,
  tokenAddress: token ?? "0x0000000000000000000000000000000000000000",
  tokenDecimals: 6,
  perTransactionCap: parseUnits("200", 6),
  dailyBudget: parseUnits("500", 6),
  statePath: ".kinga/spike-state.json", // separate from the app's ledger
});
const rpc = new JsonRpc(SEPOLIA_RPCS);

console.log("address", wallet.address);
console.log("[network] reading nonce, fees and balances...");
const balances = await wallet.refreshSnapshot(rpc);
const snapshot = wallet.snapshot!;
console.log(`  nonce ${snapshot.nonce}, maxFee ${Number(snapshot.maxFeePerGas) / 1e9} gwei, ETH ${Number(balances.eth) / 1e18}, USDT ${token ? formatUnits(balances.usdt, 6) : "n/a"}`);

wallet.allow("My own wallet (self-test)", wallet.address);
const receiptCheck: ReleaseCheck = { ok: true, issues: [] }; // the receipt side is covered by core's tests
const amount = parseUnits("1", 6);
const addressVerdict = checkAddress(wallet.address, "evm", wallet.allowlist);
console.log("[offline] preview:", await wallet.preview({ orderId: "self-test", mpesaCode: `SELF-${Date.now()}`, to: wallet.address, amount, receiptCheck, addressVerdict }));

const outcome = await wallet.release({
  orderId: "self-test",
  mpesaCode: `SELF-${Date.now()}`,
  to: wallet.address,
  amount,
  receiptCheck,
  addressVerdict,
  humanApproved: true,
});
if (!outcome.ok) throw new Error(`release blocked at ${outcome.stage}: ${outcome.reasons.join("; ")}`);
console.log(`[offline] signed nonce ${outcome.record.nonce}: ${outcome.record.raw.slice(0, 24)}... (${outcome.record.raw.length} chars)`);

const gasCost = 100_000n * BigInt(snapshot.maxFeePerGas);
if (!values.broadcast || !token || balances.eth < gasCost || balances.usdt < amount) {
  console.log(`[network] not broadcasting (flag ${values.broadcast}, token ${token ? "set" : "unset"}, ETH enough ${balances.eth >= gasCost}, USDT enough ${balances.usdt >= amount}). The signed release stays queued in .kinga/spike-state.json.`);
} else {
  console.log("[network] broadcasting...");
  for (const r of await wallet.broadcastPending(rpc)) console.log(`  sent ${r.txHash} https://sepolia.etherscan.io/tx/${r.txHash}`);
  for (const r of wallet.releases.filter((r) => r.status === "failed")) console.log(`  failed: ${r.error}`);
}
wallet.dispose();

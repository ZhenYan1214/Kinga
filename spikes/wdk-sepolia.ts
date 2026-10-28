// D0 spike: WDK on Sepolia. Checks the four things Kinga's release gate needs:
// a test account, local policies (allowlist + cap) with simulate, and signing with no provider at all.
// The seed lives only in the gitignored .env; it is never printed.
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import WDK, { PolicyViolationError } from "@tetherto/wdk";
import WalletManagerEvm, { type WalletAccountEvm } from "@tetherto/wdk-wallet-evm";

const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA_RPCS = ["https://sepolia.drpc.org", "https://ethereum-sepolia-rpc.publicnode.com"];
const ENV_PATH = new URL("../.env", import.meta.url);

function loadOrCreateSeed(): string {
  const env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const match = env.match(/^KINGA_TEST_SEED="(.+)"$/m);
  if (match?.[1]) return match[1];
  const seed = WDK.getRandomSeedPhrase();
  appendFileSync(ENV_PATH, `# Sepolia test wallet only. Never fund with real assets.\nKINGA_TEST_SEED="${seed}"\n`);
  console.log("created a new test seed in .env");
  return seed;
}

const seed = loadOrCreateSeed();
const ALLOWED = new Set<string>(); // filled with our own address below, so the self-send is the only allowed recipient
const CAP_WEI = 10n ** 15n; // 0.001 ETH

const recipientOf = (args: readonly unknown[]): string | undefined => {
  const first = args[0] as { to?: string; recipient?: string } | undefined;
  return (first?.to ?? first?.recipient)?.toLowerCase();
};
const amountOf = (args: readonly unknown[]): bigint => {
  const first = args[0] as { value?: bigint | number; amount?: bigint | number } | undefined;
  return BigInt(first?.value ?? first?.amount ?? 0);
};

const wdk = new WDK(seed).registerWallet("sepolia", WalletManagerEvm, {
  provider: SEPOLIA_RPCS,
  chainId: SEPOLIA_CHAIN_ID,
});
wdk.registerPolicy({
  id: "kinga-release-gate",
  name: "Kinga release gate",
  scope: "project",
  wallet: "sepolia",
  rules: [
    {
      name: "recipient-not-allowlisted",
      reason: "Recipient is not on the allowlist",
      operation: ["transfer", "sendTransaction", "signTransaction"],
      action: "DENY",
      conditions: [(ctx) => !ALLOWED.has(recipientOf(ctx.args) ?? "")],
    },
    {
      name: "over-cap",
      reason: "Amount is above the per-transaction cap",
      operation: ["transfer", "sendTransaction", "signTransaction"],
      action: "DENY",
      conditions: [(ctx) => amountOf(ctx.args) > CAP_WEI],
    },
    {
      name: "within-limits",
      operation: ["transfer", "sendTransaction", "signTransaction"],
      action: "ALLOW",
      conditions: [() => true],
    },
  ],
});

const account = await wdk.getAccount("sepolia", 0);
const address = await account.getAddress();
ALLOWED.add(address.toLowerCase());
console.log("address", address);

try {
  const balance = await account.getBalance();
  console.log("sepolia ETH balance (wei)", balance.toString());
} catch (error) {
  console.log("balance lookup failed (network step)", (error as Error).message);
}

const stranger = "0x000000000000000000000000000000000000dEaD";
const simulate = (account as unknown as { simulate: Record<string, (...a: unknown[]) => Promise<unknown>> }).simulate;
console.log("simulate to stranger:", await simulate.signTransaction!({ to: stranger, value: 1n }));
console.log("simulate over cap:", await simulate.signTransaction!({ to: address, value: CAP_WEI * 2n }));
console.log("simulate allowed:", await simulate.signTransaction!({ to: address, value: 1n }));

try {
  await account.signTransaction({ to: stranger, value: 1n });
  console.log("UNEXPECTED: stranger tx was signed");
} catch (error) {
  if (error instanceof PolicyViolationError) console.log("blocked as expected:", error.code, "-", error.message);
  else throw error;
}

// Signing with no provider: every field the provider would have filled in is supplied by hand.
const offline = new WDK(seed).registerWallet("sepolia-offline", WalletManagerEvm, { chainId: SEPOLIA_CHAIN_ID });
// getAccount is typed against the chain-agnostic Transaction; the EVM account takes nonce, fees and type.
const offlineAccount = (await offline.getAccount("sepolia-offline", 0)) as unknown as WalletAccountEvm;
try {
  const raw = await offlineAccount.signTransaction({
    to: address,
    value: 1n,
    nonce: 0,
    gasLimit: 21000n,
    maxFeePerGas: 30n * 10n ** 9n,
    maxPriorityFeePerGas: 10n ** 9n,
    type: 2,
    chainId: SEPOLIA_CHAIN_ID,
  });
  console.log("offline signed tx:", `${raw.slice(0, 20)}... (${raw.length} chars)`);
} catch (error) {
  console.log("offline signing failed:", (error as Error).message);
}

wdk.dispose();
offline.dispose();

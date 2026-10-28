// The USDT release gate. A release is signed only when every layer agrees, in this order:
//   1. receipt  - core's checkRelease found the money in the seller's own MPESA inbox
//   2. address  - the destination is a saved address (no look-alikes, no new addresses)
//   3. approval - a person pressed confirm
//   4. policy   - WDK's policy engine: USDT transfers only, allowlisted recipient, per-transaction cap, 24h budget
// Signing needs no network: it uses the nonce and fees from the last snapshot. Broadcasting is a separate,
// explicit network step, and WDK itself is configured without a provider so it cannot send anything.
import WDK, { PolicyViolationError, type PolicyContext } from "@tetherto/wdk";
import WalletManagerEvm, { type WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import type { AddressVerdict, ReleaseCheck } from "@kinga/core";
import { decodeTransfer, encodeTransfer, formatUnits } from "./erc20.js";
import type { ChainRpc } from "./rpc.js";
import { loadState, saveState, type ReleaseRecord, type WalletState } from "./state.js";

export interface WalletConfig {
  seed: string;
  chainId: number;
  /** The USDT contract on this chain. */
  tokenAddress: string;
  tokenDecimals: number;
  /** Largest single release, in token base units. */
  perTransactionCap: bigint;
  /** Most that may be released in any rolling 24 hours, in token base units. */
  dailyBudget: bigint;
  statePath: string;
  gasLimit?: bigint;
}

export interface ReleaseRequest {
  orderId: string;
  mpesaCode: string;
  to: string;
  amount: bigint;
  receiptCheck: ReleaseCheck;
  addressVerdict: AddressVerdict;
  humanApproved: boolean;
}

export type ReleaseStage = "receipt" | "address" | "approval" | "network_snapshot" | "policy";

export interface Blocked {
  ok: false;
  stage: ReleaseStage;
  reasons: string[];
}

export type ReleaseOutcome = { ok: true; record: ReleaseRecord } | Blocked;

const WALLET = "sepolia";
const DAY_MS = 24 * 60 * 60 * 1000;
const OPS = ["signTransaction"] as const;

export class KingaWallet {
  private state: WalletState;
  private account!: WalletAccountEvm;
  address!: string;

  private constructor(
    private readonly config: WalletConfig,
    private readonly wdk: WDK,
    private readonly now: () => Date,
  ) {
    this.state = loadState(config.statePath);
  }

  static async open(config: WalletConfig, now: () => Date = () => new Date()): Promise<KingaWallet> {
    // No provider: this WDK instance can sign but has no way to reach the network.
    const wdk = new WDK(config.seed).registerWallet(WALLET, WalletManagerEvm, { chainId: config.chainId });
    const wallet = new KingaWallet(config, wdk, now);
    // The policy must be registered before getAccount: WDK wraps the account with its policies when it hands it out.
    wallet.registerPolicy();
    wallet.account = (await wdk.getAccount(WALLET, 0)) as unknown as WalletAccountEvm;
    wallet.address = await wallet.account.getAddress();
    return wallet;
  }

  private registerPolicy(): void {
    const token = this.config.tokenAddress.toLowerCase();
    const tx = (ctx: PolicyContext) => ctx.args[0] as { to?: string | null; value?: bigint | number; data?: string } | undefined;
    const transfer = (ctx: PolicyContext) => decodeTransfer(tx(ctx)?.data);

    this.wdk.registerPolicy({
      id: "kinga-release-gate",
      name: "Kinga USDT release gate",
      scope: "project",
      wallet: WALLET,
      rules: [
        {
          name: "network-steps-are-separate",
          reason: "Kinga only signs offline; broadcasting is a separate, explicit step.",
          operation: ["transfer", "sendTransaction"],
          action: "DENY",
          conditions: [() => true],
        },
        {
          name: "usdt-transfers-only",
          reason: "Only USDT transfers can be signed by the release gate.",
          operation: [...OPS],
          action: "DENY",
          conditions: [(ctx) => tx(ctx)?.to?.toLowerCase() !== token || BigInt(tx(ctx)?.value ?? 0) !== 0n || !transfer(ctx)],
        },
        {
          name: "recipient-not-allowlisted",
          reason: "The recipient is not on your saved address list.",
          operation: [...OPS],
          action: "DENY",
          conditions: [(ctx) => !this.isAllowlisted(transfer(ctx)?.to ?? "")],
        },
        {
          name: "over-per-transaction-cap",
          reason: `A single release may not exceed ${this.format(this.config.perTransactionCap)} USDT.`,
          operation: [...OPS],
          action: "DENY",
          conditions: [(ctx) => (transfer(ctx)?.amount ?? 0n) > this.config.perTransactionCap],
        },
        {
          name: "over-24h-budget",
          reason: `Releases in the last 24 hours may not exceed ${this.format(this.config.dailyBudget)} USDT.`,
          operation: [...OPS],
          action: "DENY",
          conditions: [(ctx) => this.spentLast24h() + (transfer(ctx)?.amount ?? 0n) > this.config.dailyBudget],
        },
        { name: "within-limits", operation: [...OPS], action: "ALLOW", conditions: [() => true] },
      ],
    });
  }

  private format(units: bigint): string {
    return formatUnits(units, this.config.tokenDecimals);
  }

  private save(): void {
    saveState(this.config.statePath, this.state);
  }

  // ---- local state (no network) ----

  get allowlist() {
    return [...this.state.allowlist];
  }

  get releases() {
    return [...this.state.releases];
  }

  get snapshot() {
    return this.state.snapshot;
  }

  isAllowlisted(address: string): boolean {
    return this.state.allowlist.some((a) => a.address.toLowerCase() === address.toLowerCase());
  }

  /** Saving an address is a human decision made outside a release, never as part of one. */
  allow(label: string, address: string): void {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`not an EVM address: ${address}`);
    if (this.isAllowlisted(address)) return;
    this.state.allowlist.push({ label, address, addedAt: this.now().toISOString() });
    this.save();
  }

  spentLast24h(): bigint {
    const since = this.now().getTime() - DAY_MS;
    return this.state.releases
      .filter((r) => r.status !== "failed" && r.status !== "reverted" && Date.parse(r.signedAt) > since)
      .reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  /** Receipts that already released an order, for core's checkRelease. */
  usedMpesaCodes(): Set<string> {
    return new Set(this.state.releases.filter((r) => r.status !== "failed").map((r) => r.mpesaCode));
  }

  private nextNonce(): number | undefined {
    const snapshot = this.state.snapshot;
    if (!snapshot) return undefined;
    const used = this.state.releases.filter((r) => r.status !== "failed").map((r) => r.nonce + 1);
    return Math.max(snapshot.nonce, ...used);
  }

  /** Every gate except the signature itself, without signing. The UI shows this before asking for approval. */
  async preview(request: Omit<ReleaseRequest, "humanApproved">): Promise<{ ok: true } | Blocked> {
    const blocked = this.preflight({ ...request, humanApproved: true });
    if (blocked) return blocked;
    const decision = await this.simulate(request.to, request.amount);
    return decision ?? { ok: true };
  }

  private preflight(request: ReleaseRequest): Blocked | undefined {
    if (!request.receiptCheck.ok) {
      return { ok: false, stage: "receipt", reasons: request.receiptCheck.issues.map((i) => i.reason) };
    }
    if (request.addressVerdict.kind !== "saved") {
      return { ok: false, stage: "address", reasons: [request.addressVerdict.reason] };
    }
    if (request.addressVerdict.contact.address.toLowerCase() !== request.to.toLowerCase()) {
      return { ok: false, stage: "address", reasons: ["The address check was made for a different address."] };
    }
    if (!request.humanApproved) return { ok: false, stage: "approval", reasons: ["Waiting for you to confirm the release."] };
    if (this.nextNonce() === undefined) {
      return {
        ok: false,
        stage: "network_snapshot",
        reasons: ["Kinga needs to go online once to read the wallet's nonce and current fees before it can sign offline."],
      };
    }
    return undefined;
  }

  private unsignedTransfer(to: string, amount: bigint) {
    const snapshot = this.state.snapshot!;
    return {
      to: this.config.tokenAddress,
      value: 0n,
      data: encodeTransfer(to, amount),
      nonce: this.nextNonce()!,
      gasLimit: this.config.gasLimit ?? 100_000n,
      maxFeePerGas: BigInt(snapshot.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(snapshot.maxPriorityFeePerGas),
      type: 2,
      chainId: this.config.chainId,
    };
  }

  private async simulate(to: string, amount: bigint): Promise<Blocked | undefined> {
    const simulate = (this.account as unknown as { simulate: { signTransaction: (tx: unknown) => Promise<{ decision: string; reason: string | null }> } })
      .simulate;
    const tx = this.state.snapshot ? this.unsignedTransfer(to, amount) : { to: this.config.tokenAddress, value: 0n, data: encodeTransfer(to, amount) };
    const result = await simulate.signTransaction(tx);
    return result.decision === "DENY" ? { ok: false, stage: "policy", reasons: [result.reason ?? "Denied by policy."] } : undefined;
  }

  /** Signs the release offline and queues it for broadcast. Nothing leaves the device here. */
  async release(request: ReleaseRequest): Promise<ReleaseOutcome> {
    const blocked = this.preflight(request);
    if (blocked) return blocked;
    const tx = this.unsignedTransfer(request.to, request.amount);
    let raw: string;
    try {
      raw = await this.account.signTransaction(tx);
    } catch (error) {
      if (error instanceof PolicyViolationError) return { ok: false, stage: "policy", reasons: [error.reason ?? error.message] };
      throw error;
    }
    const record: ReleaseRecord = {
      orderId: request.orderId,
      mpesaCode: request.mpesaCode,
      to: request.to,
      amount: request.amount.toString(),
      nonce: tx.nonce,
      signedAt: this.now().toISOString(),
      raw,
      status: "signed",
    };
    this.state.releases.push(record);
    this.save();
    return { ok: true, record };
  }

  // ---- network steps ----

  /** NETWORK: read the nonce and fees so later releases can be signed offline. */
  async refreshSnapshot(rpc: ChainRpc): Promise<{ eth: bigint; usdt: bigint }> {
    const [nonce, fees, eth, usdt] = await Promise.all([
      rpc.pendingNonce(this.address),
      rpc.feeQuote(),
      rpc.ethBalance(this.address),
      rpc.tokenBalance(this.config.tokenAddress, this.address),
    ]);
    this.state.snapshot = {
      nonce,
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      takenAt: this.now().toISOString(),
    };
    this.save();
    return { eth, usdt };
  }

  /** NETWORK: send every signed release. An unreachable network leaves it queued; a node rejection marks it failed. */
  async broadcastPending(rpc: ChainRpc): Promise<ReleaseRecord[]> {
    const sent: ReleaseRecord[] = [];
    for (const record of this.state.releases.filter((r) => r.status === "signed")) {
      try {
        record.txHash = await rpc.sendRawTransaction(record.raw);
        record.status = "broadcast";
        delete record.error;
        sent.push(record);
      } catch (error) {
        const message = (error as Error).message;
        record.error = message;
        if (!/no RPC endpoint reachable/.test(message)) record.status = "failed";
      }
      this.save();
    }
    return sent;
  }

  /** NETWORK: check whether broadcast releases were mined. */
  async confirmPending(rpc: ChainRpc): Promise<void> {
    for (const record of this.state.releases.filter((r) => r.status === "broadcast" && r.txHash)) {
      const status = await rpc.receiptStatus(record.txHash!);
      if (status === "success") record.status = "confirmed";
      if (status === "reverted") record.status = "reverted";
    }
    this.save();
  }

  dispose(): void {
    this.wdk.dispose();
  }
}

// The wallet's local record: allowlist, signed releases (the rolling budget is computed from these),
// and the last network snapshot (nonce and fees) that lets signing happen offline.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AllowedRecipient {
  label: string;
  address: string;
  addedAt: string;
}

export type ReleaseStatus = "signed" | "broadcast" | "confirmed" | "reverted" | "failed";

export interface ReleaseRecord {
  orderId: string;
  /** The M-PESA receipt this release was matched against; a receipt can only release once. */
  mpesaCode: string;
  to: string;
  /** Token base units, as a decimal string so the file stays JSON. */
  amount: string;
  nonce: number;
  signedAt: string;
  raw: string;
  status: ReleaseStatus;
  txHash?: string;
  error?: string;
}

export interface NetworkSnapshot {
  nonce: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  takenAt: string;
}

export interface WalletState {
  allowlist: AllowedRecipient[];
  releases: ReleaseRecord[];
  snapshot?: NetworkSnapshot;
}

export function loadState(path: string): WalletState {
  if (!existsSync(path)) return { allowlist: [], releases: [] };
  return JSON.parse(readFileSync(path, "utf8")) as WalletState;
}

/** Write to a temp file and rename, so a crash mid-write never leaves a half-written ledger. */
export function saveState(path: string, state: WalletState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, path);
}

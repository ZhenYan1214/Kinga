// The seller's own M-PESA SMS history as a ledger. Every genuine confirmation states the new balance, so
// consecutive messages must link: balance = previous balance + received, or - (sent + transaction cost).
// A forged message cannot know the victim's real balance, so it breaks the chain; and the genuine messages
// before and after it still link up without it, which proves the money never arrived.
import { looksLikeMpesaReceipt, parseKsh, parseMpesaReceipt, type MpesaReceipt } from "./mpesa.js";
import { isMpesaSender } from "./sender.js";
import type { Message } from "./types.js";

export interface LedgerEntry {
  /** Position in the inbox, used when a message has no parseable date. */
  index: number;
  message: Message;
  receipt: MpesaReceipt;
  /** Minutes since epoch from the receipt's own date and time, when it has them. */
  at?: number;
  balance: number;
  /** Change this message made to the balance; undefined for templates we do not model (Fuliza, reversals). */
  delta?: number;
}

export type ChainStatus =
  /** The balance follows from the previous genuine message (and the next one follows from it). */
  | "fits"
  /** The genuine messages around it link up without it: the money never entered the account. */
  | "contradicts"
  /** It does not follow from the previous balance, but messages may be missing, so this is not proof. */
  | "does_not_fit"
  /** Not enough of the ledger around it to say. */
  | "unverifiable";

export interface ChainCheck {
  status: ChainStatus;
  reason: string;
  previous?: LedgerEntry;
  next?: LedgerEntry;
}

const CENT = 0.005;
const same = (a: number, b: number) => Math.abs(a - b) < CENT;
const ksh = (n: number) => `Ksh${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function minutes(receipt: MpesaReceipt): number | undefined {
  if (!receipt.date || !receipt.time) return undefined;
  const t = receipt.time.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
  if (!t) return undefined;
  let hour = Number(t[1]);
  const meridiem = t[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return Date.UTC(receipt.date.year, receipt.date.month - 1, receipt.date.day, hour, Number(t[2])) / 60_000;
}

export function balanceDelta(receipt: MpesaReceipt): number | undefined {
  if (receipt.amount === undefined) return undefined;
  if (receipt.kind === "received") return receipt.amount;
  if (receipt.kind === "sent" || receipt.kind === "paybill" || receipt.kind === "till" || receipt.kind === "withdraw") {
    return -(receipt.amount + (receipt.cost ?? 0));
  }
  return undefined;
}

function entryOf(message: Message, index: number): LedgerEntry | undefined {
  if (!looksLikeMpesaReceipt(message.text)) return undefined;
  const receipt = parseMpesaReceipt(message.text);
  const balance = receipt.balance && /^Ksh[\d,]+\.\d{2}$/.test(receipt.balance) ? parseKsh(receipt.balance) : undefined;
  if (balance === undefined) return undefined;
  return { index, message, receipt, at: minutes(receipt), balance, delta: balanceDelta(receipt) };
}

export class MpesaLedger {
  readonly entries: LedgerEntry[];
  /** Entries minus those the chain proves forged, so a spoofed message cannot vouch for its neighbours. */
  private readonly trusted: LedgerEntry[];

  /** Builds the ledger from the MPESA-sender messages of an inbox, in the order they were received. */
  constructor(private readonly inbox: readonly Message[]) {
    const entries = inbox.flatMap((m, i) => (isMpesaSender(m.sender) ? (entryOf(m, i) ?? []) : []));
    // Order by the receipts' own date and time; a message without one (Fuliza, reversals) keeps the time of the
    // message received just before it. The inbox itself may be sorted any way.
    let last = -Infinity;
    for (const e of entries) {
      if (e.at === undefined) e.at = last;
      last = e.at;
    }
    this.entries = entries.sort((a, b) => a.at! - b.at! || a.index - b.index);
    const forged = new Set(this.entries.filter((e) => this.checkAgainst(e.message, this.entries).status === "contradicts"));
    this.trusted = this.entries.filter((e) => !forged.has(e));
  }

  /** Where a message sits in time relative to the (time-sorted) ledger. Undated claims count as newest. */
  private neighbours(claim: LedgerEntry, others: LedgerEntry[]): { previous?: LedgerEntry; next?: LedgerEntry } {
    const t = claim.at ?? Infinity;
    const before = (e: LedgerEntry) => e.at! < t || (e.at === t && e.index < claim.index);
    const previous = others.filter(before).at(-1);
    const next = others.find((e) => !before(e));
    return { previous, next };
  }

  /** Does this receipt-shaped message fit the balance chain of the genuine messages around it? */
  check(message: Message): ChainCheck {
    return this.checkAgainst(message, this.trusted);
  }

  private checkAgainst(message: Message, pool: readonly LedgerEntry[]): ChainCheck {
    const index = this.inbox.indexOf(message);
    const claim = entryOf(message, index >= 0 ? index : this.inbox.length);
    if (!claim || claim.delta === undefined) {
      return { status: "unverifiable", reason: "It has no M-PESA balance to check against your history." };
    }
    const others = pool.filter((e) => e.message !== message);
    const { previous, next } = this.neighbours(claim, others);
    const backward = previous ? same(previous.balance + claim.delta, claim.balance) : undefined;
    const forward = next?.delta !== undefined ? same(claim.balance + next.delta, next.balance) : undefined;
    const linksWithout = previous && next?.delta !== undefined ? same(previous.balance + next.delta, next.balance) : undefined;

    if (backward && forward !== false) {
      return { status: "fits", reason: `Its balance follows from your previous M-PESA balance of ${ksh(previous!.balance)}.`, previous, next };
    }
    if (linksWithout && (backward === false || forward === false)) {
      return {
        status: "contradicts",
        reason: `Your M-PESA messages before and after it (${ksh(previous!.balance)}, then ${ksh(next!.balance)}) add up without it, so this ${ksh(claim.receipt.amount ?? 0)} never entered your account.`,
        previous,
        next,
      };
    }
    if (backward === false) {
      return {
        status: "does_not_fit",
        reason: `Its balance ${ksh(claim.balance)} does not follow from your last M-PESA balance of ${ksh(previous!.balance)}. Either messages are missing or it is forged.`,
        previous,
        next,
      };
    }
    return { status: "unverifiable", reason: "There are not enough M-PESA messages around it to check the balance.", previous, next };
  }

  /** Genuine incoming payments of this amount, optionally only after a point in time (minutes since epoch). */
  incoming(amount: number, since?: number): LedgerEntry[] {
    return this.trusted.filter(
      (e) => e.receipt.kind === "received" && e.receipt.amount !== undefined && same(e.receipt.amount, amount) && (since === undefined || e.at === undefined || e.at >= since),
    );
  }

  /** The newest point in time the ledger knows about. */
  latest(): number | undefined {
    return this.entries.reduce<number | undefined>((max, e) => (e.at !== undefined && (max === undefined || e.at > max) ? e.at : max), undefined);
  }
}

/** The amount someone claims to have sent, from free text: "nimetuma 2,000", "sent you Ksh1500", "3k". */
export function claimedAmount(text: string): number | undefined {
  // Whole numbers only (no digits on either side), so phone numbers and codes are not read as amounts.
  for (const match of text.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{1,7})(?![\d,])(?:\.\d{2})?\s?(k\b)?/gi)) {
    const value = Number(match[1]!.replace(/,/g, "")) * (match[2] ? 1000 : 1);
    // Skip phone numbers, years and tiny numbers.
    if (value >= 50 && value <= 1_000_000 && !/^0[17]\d{8}$/.test(match[1]!)) return value;
  }
  return undefined;
}

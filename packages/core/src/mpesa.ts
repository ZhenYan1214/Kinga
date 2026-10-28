// Structural checks for M-PESA confirmations (research notes §3). Safaricom publishes no format spec, so
// only the sender rule and the LOCKED balance are hard; template deviations are softer evidence.
import { isMpesaSender, senderKind } from "./sender.js";
import type { Message, Signal } from "./types.js";

export type ReceiptKind = "received" | "sent" | "paybill" | "till" | "withdraw" | "unknown";

export interface MpesaReceipt {
  code?: string;
  kind: ReceiptKind;
  amount?: number;
  counterparty?: string;
  counterpartyNumber?: string;
  account?: string;
  date?: { day: number; month: number; year: number };
  time?: string;
  balance?: string;
  cost?: number;
}

// \b: transaction codes can contain "SH" followed by digits (UJ3MA5SH26), which must not read as an amount.
const AMOUNT = String.raw`\b(?:Ksh|KES|KSH|Kshs\.?|Sh)\s?[\d,]+(?:\.\d+)?`;
const DATE = String.raw`(\d{1,2})\/(\d{1,2})\/(\d{2,4})`;
const TIME = String.raw`(\d{1,2}:\d{2}(?:\s?[AP]M)?)`;
const GENUINE_AMOUNT = /^Ksh\d{1,3}(?:,\d{3})*\.\d{2}$/;
const MASKING_START = Date.UTC(2026, 2, 24); // P2P counterparty numbers are masked from 24 Mar 2026

export function looksLikeMpesaReceipt(text: string): boolean {
  return (
    /\b(?:Confirmed|Imethibitishwa)\b/i.test(text) &&
    new RegExp(AMOUNT, "i").test(text) &&
    /m-?pesa|balance|received|sent to|paid to|withdraw|umepokea|salio/i.test(text)
  );
}

export function parseKsh(token: string): number | undefined {
  const match = token.match(/[\d,]+(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : undefined;
}

function splitNumber(party: string): { name: string; number?: string } {
  const match = party.match(/^(.*?)\s+((?:\+?254|0)[\d*]{6,12})$/);
  return match ? { name: match[1]!.trim(), number: match[2] } : { name: party.trim() };
}

function toDate(d: string, m: string, y: string) {
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  return { day: Number(d), month: Number(m), year };
}

export function parseMpesaReceipt(text: string): MpesaReceipt {
  const t = text.replace(/\s+/g, " ").trim();
  const receipt: MpesaReceipt = { kind: "unknown" };
  const code = t.match(/^([A-Za-z0-9]+)\s*(?:Confirmed|Imethibitishwa)/i);
  if (code) receipt.code = code[1];

  // English and the Swahili template ("Umepokea ... kutoka kwa ... tarehe ... saa ...").
  const received =
    t.match(new RegExp(String.raw`received\s+(${AMOUNT})\s+from\s+(.+?)\s+on\s+${DATE}\s+at\s+${TIME}`, "i")) ??
    t.match(new RegExp(String.raw`Umepokea\s+(${AMOUNT})\s+kutoka kwa\s+(.+?)\s+tarehe\s+${DATE}\s+saa\s+${TIME}`, "i"));
  const sent = t.match(
    new RegExp(String.raw`(${AMOUNT})\s+sent to\s+(.+?)\s+(?:for account\s+(.+?)\s+)?on\s+${DATE}\s+at\s+${TIME}`, "i"),
  );
  const paid = t.match(new RegExp(String.raw`(${AMOUNT})\s+paid to\s+(.+?)\.?\s+on\s+${DATE}\s+at\s+${TIME}`, "i"));
  const withdraw = t.match(new RegExp(String.raw`on\s+${DATE}\s+at\s+${TIME}\s*Withdraw\s+(${AMOUNT})\s+from\s+(.+?)\s+New`, "i"));

  if (received) {
    const party = splitNumber(received[2]!);
    Object.assign(receipt, {
      kind: "received",
      amount: parseKsh(received[1]!),
      counterparty: party.name,
      counterpartyNumber: party.number,
      date: toDate(received[3]!, received[4]!, received[5]!),
      time: received[6],
    });
  } else if (sent) {
    const party = splitNumber(sent[2]!);
    Object.assign(receipt, {
      kind: sent[3] ? "paybill" : "sent",
      amount: parseKsh(sent[1]!),
      counterparty: party.name,
      counterpartyNumber: party.number,
      account: sent[3],
      date: toDate(sent[4]!, sent[5]!, sent[6]!),
      time: sent[7],
    });
  } else if (paid) {
    Object.assign(receipt, {
      kind: "till",
      amount: parseKsh(paid[1]!),
      counterparty: paid[2]!.trim(),
      date: toDate(paid[3]!, paid[4]!, paid[5]!),
      time: paid[6],
    });
  } else if (withdraw) {
    Object.assign(receipt, {
      kind: "withdraw",
      amount: parseKsh(withdraw[5]!),
      counterparty: withdraw[6]!.trim(),
      date: toDate(withdraw[1]!, withdraw[2]!, withdraw[3]!),
      time: withdraw[4],
    });
  }

  const balance = t.match(/(?:New )?M-?PESA balance is\s+(\S+)|Salio jipya la M-?PESA ni\s+(\S+)/i);
  if (balance) receipt.balance = (balance[1] ?? balance[2])!.replace(/\.$/, "");
  const cost = t.match(new RegExp(String.raw`Transaction cost,?\s*(${AMOUNT})`, "i"));
  if (cost) receipt.cost = parseKsh(cost[1]!);
  return receipt;
}

/** Year letter U = 2026, T = 2025 ...; month letter A = Jan ... L = Dec. Community-observed, so only a weak signal. */
function codeMatchesDate(code: string, date: { month: number; year: number }): boolean {
  const year = code.charCodeAt(0) - "Q".charCodeAt(0) + 2022;
  const month = code.charCodeAt(1) - "A".charCodeAt(0) + 1;
  return year === date.year && month === date.month;
}

/** Signals for a message that looks like an M-PESA confirmation. Empty when it does not look like one. */
export function receiptSignals(message: Message): Signal[] {
  if (!looksLikeMpesaReceipt(message.text)) return [];
  // M-Shwari, KCB M-PESA, banks and other registered senders have their own templates; this check is about M-PESA.
  const kind = senderKind(message);
  if (!isMpesaSender(message.sender) && (kind === "official_id" || kind === "shortcode")) return [];
  // Safaricom has many more templates than the five parsed here, so from MPESA itself an unknown shape is only weak evidence.
  const templateStrength = isMpesaSender(message.sender) ? "weak" : "medium";
  const signals: Signal[] = [];
  const receipt = parseMpesaReceipt(message.text);

  if (!isMpesaSender(message.sender)) {
    if (kind === "chat") {
      signals.push({
        id: "S1",
        strength: "strong",
        evidence: message.text.slice(0, 40),
        reason: "A receipt pasted into a chat is not proof of payment; only an SMS from MPESA in your own inbox is.",
      });
    } else {
      signals.push({
        id: "S1",
        strength: message.contact ? "strong" : "hard",
        evidence: message.sender,
        reason: `Real M-PESA confirmations come only from the sender MPESA, but this one came from ${message.sender}.`,
      });
    }
  }

  if (receipt.balance !== undefined && !GENUINE_AMOUNT.test(receipt.balance)) {
    signals.push({
      id: "S2",
      strength: "hard",
      evidence: `balance is ${receipt.balance}`,
      reason: `The balance reads "${receipt.balance}" instead of an amount; "LOCKED" balances are a known forgery marker.`,
    });
  }

  if (!receipt.code) {
    signals.push({
      id: "S6",
      strength: "strong",
      evidence: message.text.slice(0, 20),
      reason: "It does not start with a transaction code before \"Confirmed\", as every M-PESA confirmation does.",
    });
  } else if (!/^[A-Z0-9]{10}$/.test(receipt.code)) {
    signals.push({
      id: "S6",
      strength: "strong",
      evidence: receipt.code,
      reason: `The transaction code "${receipt.code}" is not 10 uppercase letters and digits.`,
    });
  } else if (receipt.date && !codeMatchesDate(receipt.code, receipt.date)) {
    signals.push({
      id: "S6",
      strength: "weak",
      evidence: receipt.code,
      reason: `The code "${receipt.code}" does not start with the year and month letters usually seen for that date.`,
    });
  }

  const badAmounts = (message.text.match(new RegExp(AMOUNT, "gi")) ?? []).filter((a) => !GENUINE_AMOUNT.test(a));
  if (badAmounts.length > 0) {
    signals.push({
      id: "S7",
      strength: "medium",
      evidence: badAmounts[0]!,
      reason: `The amount "${badAmounts[0]}" is not written the M-PESA way (for example Ksh3,500.00).`,
    });
  }
  if (receipt.kind === "unknown") {
    signals.push({
      id: "S7",
      strength: templateStrength,
      evidence: message.text.slice(0, 40),
      reason: "The wording does not match any M-PESA template (received, sent, paybill, till or withdraw).",
    });
  } else if (receipt.kind !== "received" && receipt.cost === undefined) {
    signals.push({
      id: "S7",
      strength: "medium",
      evidence: receipt.kind,
      reason: "A real M-PESA payment confirmation always states the transaction cost; this one does not.",
    });
  }
  if (receipt.balance === undefined) {
    signals.push({
      id: "S7",
      strength: templateStrength,
      evidence: "no balance line",
      reason: "There is no \"New M-PESA balance is ...\" line.",
    });
  }

  const longYear = message.text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0];
  const clock24 = receipt.time && !/[AP]M$/i.test(receipt.time) ? receipt.time : undefined;
  if (longYear || clock24) {
    signals.push({
      id: "S7",
      strength: "medium",
      evidence: longYear ?? clock24!,
      reason: `"${longYear ?? clock24}" is not how M-PESA writes dates and times (it uses 27/10/26 and 6:14 PM).`,
    });
  }

  if (
    receipt.kind === "received" &&
    receipt.date &&
    receipt.counterpartyNumber &&
    !receipt.counterpartyNumber.includes("*") &&
    Date.UTC(receipt.date.year, receipt.date.month - 1, receipt.date.day) >= MASKING_START
  ) {
    signals.push({
      id: "S8",
      strength: "medium",
      evidence: receipt.counterpartyNumber,
      reason: "Since March 2026 M-PESA hides part of the sender's number, but this message shows the full number.",
    });
  }
  return signals;
}

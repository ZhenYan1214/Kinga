// Act 2: before a P2P seller releases USDT, reconcile the buyer's "I paid" against the seller's own inbox.
// Only a structurally valid "received" SMS from MPESA counts; screenshots and pasted receipts never do.
import { looksLikeMpesaReceipt, parseMpesaReceipt, receiptSignals, type MpesaReceipt } from "./mpesa.js";
import { MpesaLedger } from "./ledger.js";
import { isMpesaSender } from "./sender.js";
import type { Message } from "./types.js";

export interface P2pOrder {
  amountKsh: number;
  /** The buyer's verified name on the exchange. Omit to check only that the money arrived (e.g. a shop counter). */
  buyerKycName?: string;
  /** Transaction code the buyer quoted, if any. */
  claimedCode?: string;
}

export type ReleaseIssueCode =
  | "NO_RECEIPT"
  | "CODE_NOT_IN_INBOX"
  | "FORGED_IN_INBOX"
  | "AMOUNT_MISMATCH"
  | "NAME_MISMATCH"
  | "CODE_ALREADY_USED";

export interface ReleaseIssue {
  code: ReleaseIssueCode;
  reason: string;
}

export interface ReleaseCheck {
  ok: boolean;
  receipt?: MpesaReceipt;
  issues: ReleaseIssue[];
}

const tokens = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

/** M-PESA shows two names; the KYC name may have three. Every receipt name must appear in the KYC name. */
export function namesMatch(receiptName: string, kycName: string): boolean {
  const kyc = new Set(tokens(kycName));
  const shown = tokens(receiptName);
  return shown.length > 0 && shown.every((t) => kyc.has(t));
}

export function checkRelease(order: P2pOrder, inbox: readonly Message[], usedCodes: ReadonlySet<string> = new Set()): ReleaseCheck {
  const receipts = inbox.filter((m) => looksLikeMpesaReceipt(m.text));
  // Genuine = from MPESA, well-formed, and consistent with the balances of the messages around it.
  const ledger = new MpesaLedger(inbox);
  const brokenChain = (m: Message) => ["contradicts", "does_not_fit"].includes(ledger.check(m).status);
  const genuine = receipts
    .filter((m) => isMpesaSender(m.sender) && receiptSignals(m).every((s) => s.strength === "weak") && !brokenChain(m))
    .map((m) => parseMpesaReceipt(m.text))
    .filter((r) => r.kind === "received");
  const issues: ReleaseIssue[] = [];

  if (order.claimedCode) {
    const claimed = order.claimedCode.toUpperCase();
    const withCode = receipts.filter((m) => parseMpesaReceipt(m.text).code?.toUpperCase() === claimed);
    const forged = withCode.find((m) => !isMpesaSender(m.sender));
    // A message that claims to be from MPESA but breaks the balance chain is forged too (spoofed sender ID).
    const spoofed = withCode.find((m) => isMpesaSender(m.sender) && ledger.check(m).status === "contradicts");
    if (forged) {
      issues.push({
        code: "FORGED_IN_INBOX",
        reason: `The code ${claimed} only appears in a message from ${forged.sender}, not from MPESA. That message is forged.`,
      });
    } else if (spoofed) {
      issues.push({ code: "FORGED_IN_INBOX", reason: `The message with code ${claimed} looks like M-PESA, but: ${ledger.check(spoofed).reason}` });
    }
  }

  const candidates = order.claimedCode
    ? genuine.filter((r) => r.code?.toUpperCase() === order.claimedCode!.toUpperCase())
    : genuine.filter((r) => r.amount === order.amountKsh);

  if (candidates.length === 0) {
    issues.push(
      order.claimedCode
        ? {
            code: "CODE_NOT_IN_INBOX",
            reason: `No SMS from MPESA in your inbox has the code ${order.claimedCode.toUpperCase()}. Do not release until it arrives.`,
          }
        : {
            code: "NO_RECEIPT",
            reason: `No SMS from MPESA shows Ksh${order.amountKsh.toLocaleString("en-US", { minimumFractionDigits: 2 })} received. Do not release until it arrives.`,
          },
    );
    return { ok: false, issues };
  }

  // Prefer a receipt that also matches the buyer's name, so a second payment from someone else doesn't hide it.
  const buyer = order.buyerKycName;
  const receipt = candidates.find((r) => buyer && r.counterparty && namesMatch(r.counterparty, buyer)) ?? candidates[0]!;
  if (receipt.amount !== order.amountKsh) {
    issues.push({
      code: "AMOUNT_MISMATCH",
      reason: `The M-PESA receipt is for Ksh${receipt.amount} but the order is for Ksh${order.amountKsh}.`,
    });
  }
  if (buyer && (!receipt.counterparty || !namesMatch(receipt.counterparty, buyer))) {
    issues.push({
      code: "NAME_MISMATCH",
      reason: `The money came from ${receipt.counterparty ?? "an unknown payer"}, not from the buyer ${buyer}. This is how triangular fraud starts: the real payer may later report you.`,
    });
  }
  if (receipt.code && usedCodes.has(receipt.code)) {
    issues.push({
      code: "CODE_ALREADY_USED",
      reason: `The receipt ${receipt.code} was already used to release an earlier order.`,
    });
  }
  return { ok: issues.length === 0, receipt, issues };
}

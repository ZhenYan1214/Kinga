// What to do next, per category. Official channels from the research notes (§1): 333 to report a scam SMS,
// 456 for reversals (started by the sender), 334 to verify a masked sender, 0722 000 000 is Safaricom's only caller.
import type { Category, RiskLevel } from "./types.js";

const REPORT = "Forward the message to 333 (free) so Safaricom can block the number.";

const ADVICE: Record<Category, string[]> = {
  not_scam: [],
  wrong_send_reversal: [
    "Do not send anything back. If the money really arrived, the sender must ask Safaricom to reverse it through 456.",
    "Check your real balance in the M-PESA app or with *334#.",
    REPORT,
  ],
  fake_mpesa_confirmation: [
    "Check your real balance in the M-PESA app or with *334# before handing over goods or crypto.",
    "Only an SMS from MPESA in your own inbox counts; screenshots and forwarded texts do not.",
    REPORT,
  ],
  fake_loan_or_fuliza: ["Fuliza and loan limits are set by the system and cannot be bought. Do not pay any fee.", REPORT],
  fake_customer_care: [
    "Never share your PIN, PUK or codes. Safaricom calls only from 0722 000 000 and never asks for your PIN.",
    "If you are worried about your line, dial 100 from your phone.",
    REPORT,
  ],
  fake_prize: ["You cannot win a promotion you did not enter. Do not pay a fee or open the link.", REPORT],
  relative_impersonation: [
    "Call the person on the number already saved in your phone before sending anything.",
    "Do not pay to a new number or paybill until they confirm it by voice.",
  ],
  sim_swap: [
    "Do not share any code you receive. If your phone suddenly shows No Service, call 100 from another phone.",
    REPORT,
  ],
  investment_or_crypto: ["Guaranteed returns are always a scam. Do not deposit money or USDT.", "Check whether the firm is licensed by the CMA."],
  job_scam: ["Real employers do not charge fees to apply or train. Check agencies on the NEA licensed list.", REPORT],
  betting_tips: ["Nobody can sell fixed matches. Do not pay for tips.", REPORT],
  government_impersonation: ["Government agencies are paid only through eCitizen or their official paybill, never a personal number.", REPORT],
  lookalike_paybill: ["Check the paybill or till against the business's official website or receipt before paying.", REPORT],
  romance_or_extortion: ["Do not pay. Keep the messages as evidence and report to the DCI hotline 0800 722 203."],
  p2p_payment_fraud: [
    "Do not release until an SMS from MPESA for the exact amount, from the buyer's own name, is in your inbox.",
    "Keep the trade and all chat on the exchange; open an appeal there if the buyer pushes.",
  ],
};

export function adviceFor(category: Category, level: RiskLevel): string[] {
  return level === "safe" ? [] : ADVICE[category];
}

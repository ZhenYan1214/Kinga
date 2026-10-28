// Turns signals into a risk level and a category guess, and merges in the LLM's view.
// The rule: the LLM can only make the verdict more cautious, never clear what the rules flagged.
import { looksLikeMpesaReceipt, receiptSignals } from "./mpesa.js";
import { isMpesaSender } from "./sender.js";
import { textSignals } from "./signals.js";
import { RISK_ORDER, type Category, type Message, type RiskLevel, type Signal, type SignalId } from "./types.js";

const POINTS = { hard: 100, strong: 3, medium: 2, weak: 1 } as const;

export interface RuleVerdict {
  level: RiskLevel;
  category: Category;
  score: number;
  signals: Signal[];
  /** A structurally valid receipt from the MPESA sender with no red flags. */
  verifiedReceipt: boolean;
}

export function analyze(message: Message): RuleVerdict {
  const signals = [...receiptSignals(message), ...textSignals(message)];
  const score = signals.reduce((sum, s) => sum + POINTS[s.strength], 0);
  const level: RiskLevel = score >= 100 ? "scam" : score >= 5 ? "high_risk" : score >= 3 ? "suspicious" : "safe";
  const verifiedReceipt =
    isMpesaSender(message.sender) && looksLikeMpesaReceipt(message.text) && signals.every((s) => s.strength === "weak");
  return { level, category: level === "safe" ? "not_scam" : guessCategory(message, signals), score, signals, verifiedReceipt };
}

const CATEGORY_CUES: [Category, RegExp][] = [
  ["fake_loan_or_fuliza", /\b(?:fuliza|loan|mkopo|hustler fund|limit|okoa)\b/i],
  ["fake_customer_care", /\b(?:customer care|double registration|registered twice|line (?:will be )?suspend|sim (?:card )?(?:will be )?(?:block|deactiv)|puk)\b/i],
  ["sim_swap", /\b(?:sim (?:swap|replacement)|replace(?:ment)? (?:sim|line)|new sim|otp|verification code)\b/i],
  ["fake_prize", /\b(?:won|winner|umeshinda|prize|zawadi|promotion|jackpot|lucky)\b/i],
  ["investment_or_crypto", /\b(?:invest\w*|forex|trading|mining|bot|platform|returns?|profit|usdt|crypto|bitcoin)\b/i],
  ["job_scam", /\b(?:job|kazi|vacanc\w*|recruit\w*|interview|salary|mshahara|employment|abroad|qatar|dubai|saudi|malaysia)\b/i],
  ["betting_tips", /\b(?:odds|bet\w*|fixed|jackpot|vip tips|sportpesa|odibets|mozzart)\b/i],
  ["government_impersonation", /\b(?:helb|kra|sha|nhif|e-?citizen|huduma|government|serikali|ntsa|county)\b/i],
  ["lookalike_paybill", /\b(?:paybill|till|lipa na m-?pesa|business no|account no)\b/i],
  ["romance_or_extortion", /\b(?:love|darling|baby|dear|video|photos|nude|expose|leak)\b/i],
  ["relative_impersonation", /\b(?:mum|mom|mama|dad|baba|bro|sis|landlord|rent|kodi|nimebadilisha namba|tuma kwa hii)\b/i],
];

function guessCategory(message: Message, signals: Signal[]): Category {
  const has = (id: SignalId) => signals.some((s) => s.id === id);
  if (message.channel === "p2p_chat") return "p2p_payment_fraud";
  if (has("S3")) return "wrong_send_reversal";
  if (has("S1") || has("S2")) return "fake_mpesa_confirmation";
  if (has("S23")) return "betting_tips";
  if (has("S24")) return "fake_loan_or_fuliza";
  if (has("S22")) return "fake_prize";
  if (has("S17") || has("S20")) return "investment_or_crypto";
  if (has("S15") || has("S16")) return "relative_impersonation";
  for (const [category, cue] of CATEGORY_CUES) if (cue.test(message.text)) return category;
  return "fake_customer_care";
}

export interface LlmView {
  category: Category;
  scam_likelihood: "low" | "medium" | "high";
}

export interface FusedVerdict extends RuleVerdict {
  /** Which side set the final level. */
  decidedBy: "rules" | "llm";
}

export const LLM_LEVEL: Record<LlmView["scam_likelihood"], RiskLevel> = { low: "safe", medium: "suspicious", high: "high_risk" };
const maxLevel = (a: RiskLevel, b: RiskLevel) => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b);

/**
 * The LLM can raise the level but never above high_risk (only rules can say "scam"). Whether an MPESA
 * receipt is genuine is the structural check's call alone, so the LLM cannot raise a verified receipt.
 */
export function fuse(rules: RuleVerdict, llm: LlmView | undefined): FusedVerdict {
  if (!llm || rules.verifiedReceipt) return { ...rules, decidedBy: "rules" };
  const level = maxLevel(rules.level, LLM_LEVEL[llm.scam_likelihood]);
  const decidedBy = level === rules.level ? "rules" : "llm";
  // Rules name the category when they found strong evidence; otherwise trust the model's reading.
  const strongRules = rules.signals.some((s) => s.strength === "hard" || s.strength === "strong");
  const category: Category =
    level === "safe" ? "not_scam" : strongRules ? rules.category : llm.category !== "not_scam" ? llm.category : rules.category;
  return { ...rules, level, category, decidedBy };
}

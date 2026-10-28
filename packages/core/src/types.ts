export type Channel = "sms" | "whatsapp" | "p2p_chat";

export interface Message {
  channel: Channel;
  /** What the phone shows as the sender: an alphanumeric ID ("MPESA"), a number, or "P2P buyer". */
  sender: string;
  /** Saved phonebook name when the sender number is a known contact. */
  contact?: string | null;
  text: string;
}

export const CATEGORIES = [
  "not_scam",
  "wrong_send_reversal",
  "fake_mpesa_confirmation",
  "fake_loan_or_fuliza",
  "fake_customer_care",
  "fake_prize",
  "relative_impersonation",
  "sim_swap",
  "investment_or_crypto",
  "job_scam",
  "betting_tips",
  "government_impersonation",
  "lookalike_paybill",
  "romance_or_extortion",
  "p2p_payment_fraud",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * S1–S20 follow the research notes (kenya_scam_patterns.md §4). S21+ are Kinga additions:
 * S21 P2P release pressure, S22 unsolicited prize, S23 "sure odds", S24 loan-limit boost,
 * S25 payment to a personal number.
 */
export type SignalId =
  | "S1" | "S2" | "S3" | "S4" | "S6" | "S7" | "S8" | "S9" | "S10" | "S11" | "S12" | "S13"
  | "S14" | "S15" | "S16" | "S17" | "S18" | "S19" | "S20" | "S21" | "S22" | "S23" | "S24" | "S25";

/** hard = on its own enough to call it a scam; the LLM can never clear a hard signal. */
export type Strength = "hard" | "strong" | "medium" | "weak";

export interface Signal {
  id: SignalId;
  strength: Strength;
  /** The exact text that triggered the signal, so the UI can highlight it. */
  evidence: string;
  /** One plain-English sentence for the verdict card. */
  reason: string;
}

export type RiskLevel = "safe" | "suspicious" | "high_risk" | "scam";
export const RISK_ORDER: readonly RiskLevel[] = ["safe", "suspicious", "high_risk", "scam"];

export type SenderKind = "official_id" | "shortcode" | "phone" | "chat";

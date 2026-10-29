// Typed calls to the local Kinga service. Everything goes to 127.0.0.1 except the two /api/network/* steps,
// which the server forwards to Sepolia and the UI labels as network steps.

export type Level = "safe" | "suspicious" | "high_risk" | "scam";

export interface Signal {
  id: string;
  strength: "hard" | "strong" | "medium" | "weak";
  evidence: string;
  reason: string;
  reasonSw: string;
}

export interface Verdict {
  level: Level;
  category: string;
  decidedBy: "rules" | "llm";
  signals: Signal[];
  advice: string[];
  adviceSw: string[];
  model?: { red_flags: string[]; explanation: string; impersonates: string; requested_action: string; ms: number };
  modelNote?: string;
}

export interface InboxItem {
  id: string;
  time: string;
  channel: "sms" | "whatsapp" | "p2p_chat";
  sender: string;
  contact?: string | null;
  text: string;
  verdict: Verdict | null;
}

export interface Order {
  id: string;
  buyerKycName: string;
  amountKsh: number;
  usdt: string;
  claimedCode: string;
  chat: string[];
  story: string;
  buyerAddress: string;
  lookalikeAddress: string;
  screenshot: string;
}

export interface ScreenshotFields {
  transaction_code: string;
  amount: number;
  counterparty: string;
  direction: "sent" | "received" | "unknown";
  date: string;
  time: string;
}

export interface DemoClaim {
  id: string;
  who: string;
  expectsKsh: number;
  payerName: string;
  screenshot: string;
  story: string;
}

export interface InboxSource {
  source: "demo" | "imported";
  messages: number;
  mpesa: number;
}

export interface PaymentCheck {
  ok: boolean;
  issues: { code: string; reason: string; reasonSw: string }[];
  receipt?: { code?: string; amount?: number; counterparty?: string; date?: { day: number; month: number; year: number }; time?: string };
}

export interface VerifyResult {
  screenshot: { fields: ScreenshotFields; ms: number };
  check: PaymentCheck;
  /** Where the expected amount came from; "screenshot" means only the model's reading, which never proves an edit. */
  amountFrom: "claim" | "user" | "screenshot";
}

export interface LedgerRow {
  id?: string;
  time?: string;
  code?: string;
  kind: string;
  counterparty?: string;
  amount?: number;
  delta?: number;
  balance: number;
  status: "fits" | "contradicts" | "does_not_fit" | "unverifiable";
  reason: string;
}

export interface Blocked {
  ok: false;
  stage: "receipt" | "address" | "approval" | "network_snapshot" | "policy";
  reasons: string[];
}

export interface ReleaseCheckResult {
  claim: { code: string; screenshot?: { fields: ScreenshotFields; ms: number } };
  receiptCheck: { ok: boolean; issues: { code: string; reason: string }[]; receipt?: { code?: string; amount?: number; counterparty?: string } };
  addressVerdict: { kind: "saved" | "poisoning" | "new" | "invalid" | "wrong_network"; reason?: string; contact?: { label: string } };
  chat: Verdict;
  gate: { ok: true } | Blocked;
}

export interface WalletView {
  address: string;
  tokenConfigured: boolean;
  snapshot?: { nonce: number; maxFeePerGas: string; takenAt: string };
  spentLast24h: string;
  dailyBudget: string;
  perTransactionCap: string;
  allowlist: { label: string; address: string }[];
  releases: { orderId: string; to: string; amount: string; nonce: number; status: string; txHash?: string; error?: string; rawPreview: string; signedAt: string }[];
}

export interface Status {
  model: "disabled" | "loading" | "ready" | "failed";
  reader: "disabled" | "loading" | "ready" | "failed";
  inbox: InboxSource;
  /** null when no test seed is set up: the USDT release is optional. */
  wallet: WalletView | null;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `${response.status}`);
  return data;
}

export const api = {
  status: () => call<Status>("GET", "/api/status"),
  inbox: () => call<InboxItem[]>("GET", "/api/inbox"),
  analyzeInbox: (id: string) => call<Verdict>("POST", `/api/inbox/${id}/analyze`),
  analyze: (m: { channel: string; sender: string; contact: string | null; text: string }) => call<Verdict>("POST", "/api/analyze", m),
  verify: (input: { claimId?: string; image?: string; amountKsh?: number; buyerName?: string }) => call<VerifyResult>("POST", "/api/verify", input),
  claims: () => call<DemoClaim[]>("GET", "/api/claims"),
  importInbox: (xml: string) => call<InboxSource>("POST", "/api/inbox/import", { xml }),
  useDemoInbox: () => call<InboxSource>("POST", "/api/inbox/demo"),
  ledger: () => call<LedgerRow[]>("GET", "/api/ledger"),
  orders: () => call<Order[]>("GET", "/api/orders"),
  checkRelease: (orderId: string, to: string) => call<ReleaseCheckResult>("POST", "/api/release/check", { orderId, to }),
  confirmRelease: (orderId: string, to: string) =>
    call<{ outcome: { ok: true; nonce: number; rawPreview: string } | Blocked; wallet: WalletView }>("POST", "/api/release/confirm", { orderId, to, humanApproved: true }),
  allow: (label: string, address: string) => call<WalletView>("POST", "/api/allowlist", { label, address }),
  snapshot: () => call<{ eth: string; usdt: string | null; wallet: WalletView }>("POST", "/api/network/snapshot"),
  broadcast: () => call<{ sent: string[]; wallet: WalletView }>("POST", "/api/network/broadcast"),
};

export const LEVEL_LABEL: Record<Level, string> = { safe: "Looks fine", suspicious: "Suspicious", high_risk: "High risk", scam: "Scam" };

export const CATEGORY_LABEL: Record<string, string> = {
  not_scam: "Ordinary message",
  wrong_send_reversal: "Fake 'sent by mistake' refund",
  fake_mpesa_confirmation: "Fake M-PESA confirmation",
  fake_loan_or_fuliza: "Fake loan or Fuliza offer",
  fake_customer_care: "Fake customer care / PIN phishing",
  fake_prize: "Fake prize",
  relative_impersonation: "Someone pretending to be family or landlord",
  sim_swap: "SIM-swap attempt",
  investment_or_crypto: "Investment or crypto scheme",
  job_scam: "Job scam",
  betting_tips: "Fixed-match betting tips",
  government_impersonation: "Fake government agency",
  lookalike_paybill: "Look-alike paybill or till",
  romance_or_extortion: "Romance or extortion",
  p2p_payment_fraud: "P2P payment fraud",
};

export const LEVEL_LABEL_SW: Record<Level, string> = { safe: "Inaonekana salama", suspicious: "Ya kutiliwa shaka", high_risk: "Hatari kubwa", scam: "Utapeli" };

export const CATEGORY_LABEL_SW: Record<string, string> = {
  not_scam: "Ujumbe wa kawaida",
  wrong_send_reversal: "Ombi feki la kurudisha pesa 'iliyotumwa kimakosa'",
  fake_mpesa_confirmation: "Ujumbe feki wa M-PESA",
  fake_loan_or_fuliza: "Ofa feki ya mkopo au Fuliza",
  fake_customer_care: "Huduma kwa wateja feki / wizi wa PIN",
  fake_prize: "Zawadi feki",
  relative_impersonation: "Mtu anayejifanya ndugu au mwenye nyumba",
  sim_swap: "Jaribio la kubadilisha laini (SIM swap)",
  investment_or_crypto: "Mpango wa uwekezaji au crypto",
  job_scam: "Utapeli wa kazi",
  betting_tips: "Tips za mechi zilizopangwa",
  government_impersonation: "Shirika feki la serikali",
  lookalike_paybill: "Paybill au till inayofanana na halisi",
  romance_or_extortion: "Mapenzi au vitisho",
  p2p_payment_fraud: "Udanganyifu wa malipo ya P2P",
};

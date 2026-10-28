// The model reads the message and explains it. It sees what the deterministic rules already found and is told
// to explain those findings, not overrule them; fusion (core/fuse.ts) makes sure it can only add caution.
import "./env.js";
import { close, completion, loadModel, unloadModel, QWEN3_4B_INST_Q4_K_M } from "@qvac/sdk";
import { CATEGORIES, senderKind, type Category, type Message, type Signal } from "@kinga/core";

export interface ModelVerdict {
  red_flags: string[];
  explanation: string;
  impersonates: string;
  requested_action: string;
  scam_likelihood: "low" | "medium" | "high";
  category: Category;
}

// Reasoning fields come first so the model commits to a category only after writing down the evidence.
export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    red_flags: { type: "array", items: { type: "string" }, maxItems: 4 },
    explanation: { type: "string" },
    impersonates: { type: "string" },
    requested_action: { type: "string" },
    scam_likelihood: { type: "string", enum: ["low", "medium", "high"] },
    category: { type: "string", enum: CATEGORIES },
  },
  required: ["red_flags", "explanation", "impersonates", "requested_action", "scam_likelihood", "category"],
  additionalProperties: false,
};

const CATEGORY_GUIDE: Record<Category, string> = {
  not_scam: "an ordinary or genuine message (most messages are this)",
  wrong_send_reversal: "says money was sent to you by mistake and asks you to send it back yourself",
  fake_mpesa_confirmation: "a forged M-PESA receipt, used to make you hand over money, goods or crypto",
  fake_loan_or_fuliza: "offers a loan, Hustler Fund or a higher Fuliza limit for a fee, link or your details",
  fake_customer_care: "pretends to be Safaricom/bank support and asks for your PIN, PUK or to dial codes",
  fake_prize: "says you won a prize or promotion you never entered",
  relative_impersonation: "pretends to be family, a friend or the landlord, or redirects a payment to a new number",
  sim_swap: "tries to get your OTP, ID details or SIM replacement codes to take over your line",
  investment_or_crypto: "promises returns from trading, mining, forex or crypto, often in USDT",
  job_scam: "offers a job, often abroad, that needs a fee first",
  betting_tips: "sells sure odds or fixed matches",
  government_impersonation: "pretends to be HELB, KRA, SHA, eCitizen or another agency asking for payment",
  lookalike_paybill: "gives a paybill or till that imitates a real business",
  romance_or_extortion: "a romance, sextortion or threat to expose you",
  p2p_payment_fraud: "a P2P crypto buyer pushing you to release before the M-PESA money is really in your account",
};

const SYSTEM = [
  "You check SMS, WhatsApp and P2P-trade chat messages for someone in Kenya who uses M-Pesa and USDT.",
  "Messages may mix English, Swahili and Sheng. Most messages people receive are ordinary; only call something a scam when the message itself gives a reason.",
  "Facts: genuine M-PESA confirmations come only from the sender MPESA. Safaricom staff never ask for a PIN. Mistaken transfers are reversed through 456, never by the receiver sending money back. Only an MPESA SMS in your own inbox proves a payment; screenshots do not.",
  "You may be given findings from deterministic checks. They are correct: explain them in plain words and do not contradict them. You may add other red flags you see in the text.",
  "Only list red flags that are literally in the message. Write the explanation as two short sentences a non-expert understands. Use impersonates \"none\" and requested_action \"none\" when they do not apply.",
  "Categories:",
  ...CATEGORIES.map((c) => `- ${c}: ${CATEGORY_GUIDE[c]}`),
  "/no_think",
].join("\n");

function describeSender(message: Message): string {
  const kind = senderKind(message);
  if (kind === "chat") return "a buyer in a P2P crypto order chat";
  if (message.contact) return `${message.sender} (saved contact: ${message.contact})`;
  if (kind === "phone") return `${message.sender} (unknown number, not in contacts)`;
  return `${message.sender} (registered sender name)`;
}

function userTurn(message: Message, findings: readonly Signal[] | undefined): string {
  const lines = [`Channel: ${message.channel}`, `Sender: ${describeSender(message)}`, `Message: ${message.text}`];
  if (findings) {
    lines.push(
      findings.length === 0
        ? "Deterministic checks: nothing found."
        : `Deterministic checks found:\n${findings.map((s) => `- ${s.reason}`).join("\n")}`,
    );
  }
  return lines.join("\n");
}

// Hand-written examples, kept apart from the eval set.
const EXAMPLES: { message: Message; findings: Signal[]; verdict: ModelVerdict }[] = [
  {
    message: { channel: "sms", sender: "0745118220", text: "TK4RT8812Q Confirmed. You have received Ksh7,000.00 from PAUL OUMA on 14/10/26 at 8:40 PM New M-PESA balance is *LOCKED* pls confirm and send back 2000 extra" },
    findings: [
      { id: "S1", strength: "hard", evidence: "0745118220", reason: "Real M-PESA confirmations come only from the sender MPESA, but this one came from 0745118220." },
      { id: "S2", strength: "hard", evidence: "balance is *LOCKED*", reason: "The balance reads \"*LOCKED*\" instead of an amount; \"LOCKED\" balances are a known forgery marker." },
    ],
    verdict: {
      red_flags: ["comes from a personal number, not MPESA", "balance shown as *LOCKED*", "asks you to send 2000 back"],
      explanation: "This is a fake M-PESA receipt sent from an ordinary phone number, and the balance line is a known forgery sign. Check your real balance in the M-PESA app and do not send anything back.",
      impersonates: "M-PESA",
      requested_action: "send Ksh2,000 back",
      scam_likelihood: "high",
      category: "fake_mpesa_confirmation",
    },
  },
  {
    message: { channel: "sms", sender: "0722410733", contact: "Baba", text: "Wambui nitumie 1500 ya stima, nitakurudishia mwisho wa mwezi." },
    findings: [],
    verdict: {
      red_flags: [],
      explanation: "This is a money request from a saved contact (Baba) in his usual way, with nothing unusual in it. If it feels out of character, call him on the number you know before sending.",
      impersonates: "none",
      requested_action: "send Ksh1,500 for electricity",
      scam_likelihood: "low",
      category: "not_scam",
    },
  },
  {
    message: { channel: "whatsapp", sender: "+254798230114", text: "Habari, we have shortlisted you for a warehouse job in Doha, Ksh 120k per month. Pay medical and visa processing to our agent 0798230114 to secure your slot by Friday." },
    findings: [
      { id: "S10", strength: "strong", evidence: "visa processing", reason: "It wants a payment up front (\"medical and visa processing\"). Genuine loans, prizes, jobs and refunds do not charge a fee first." },
    ],
    verdict: {
      red_flags: ["unsolicited job offer abroad", "fee for medical and visa processing", "payment to a personal number", "deadline to secure a slot"],
      explanation: "A real employer does not ask you to pay fees to a personal number before you start. Check the agency on the NEA licensed list and do not pay.",
      impersonates: "a recruitment agency",
      requested_action: "pay processing fees",
      scam_likelihood: "high",
      category: "job_scam",
    },
  },
];

export interface Assessment {
  verdict: ModelVerdict | undefined;
  raw: string;
  ms: number;
  tokens?: number;
  tokensPerSecond?: number;
}

export class KingaModel {
  private constructor(private readonly modelId: string) {}

  /** Any QVAC LLM model constant (QWEN3_4B_INST_Q4_K_M by default); typed loosely since each constant is its own literal type. */
  static async load(modelSrc: object = QWEN3_4B_INST_Q4_K_M): Promise<KingaModel> {
    // The default 1024-token context is too small for the system prompt plus the worked examples.
    return new KingaModel(await loadModel({ modelSrc: modelSrc as typeof QWEN3_4B_INST_Q4_K_M, modelConfig: { ctx_size: 4096 } }));
  }

  /** findings undefined = model alone (no rule input); [] = rules ran and found nothing. */
  async assess(message: Message, findings?: readonly Signal[]): Promise<Assessment> {
    const started = performance.now();
    const history = [
      { role: "system", content: SYSTEM },
      ...EXAMPLES.flatMap((e) => [
        { role: "user", content: userTurn(e.message, findings ? e.findings : undefined) },
        { role: "assistant", content: JSON.stringify(e.verdict) },
      ]),
      { role: "user", content: userTurn(message, findings) },
    ];
    let final;
    try {
      const run = completion({
        modelId: this.modelId,
        stream: false,
        history,
        responseFormat: { type: "json_schema", json_schema: { name: "verdict", schema: VERDICT_SCHEMA } },
      });
      final = await run.final;
    } catch (error) {
      // A failed call leaves the verdict to the rules alone; it never blocks them.
      return { verdict: undefined, raw: `error: ${(error as Error).message}`, ms: performance.now() - started };
    }
    const raw = final.contentText.trim();
    let verdict: ModelVerdict | undefined;
    try {
      verdict = JSON.parse(raw) as ModelVerdict;
    } catch {
      verdict = undefined;
    }
    return {
      verdict,
      raw,
      ms: performance.now() - started,
      tokens: final.stats?.generatedTokens,
      tokensPerSecond: final.stats?.tokensPerSecond,
    };
  }

  async unload(): Promise<void> {
    await unloadModel({ modelId: this.modelId });
    void close();
  }
}

// D0 spike: can Qwen3 4B, loaded from the local cache, return schema-valid JSON verdicts, and how fast?
// Meant to be run with the network switched off: npm run spike:llm
import "./qvac-env.js";
import { close, completion, loadModel, unloadModel, QWEN3_4B_INST_Q4_K_M } from "@qvac/sdk";

const CATEGORIES = [
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
  "not_scam",
] as const;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    scam_likelihood: { type: "string", enum: ["low", "medium", "high"] },
    impersonates: { type: "string" },
    requested_action: { type: "string" },
    red_flags: { type: "array", items: { type: "string" }, maxItems: 5 },
    explanation: { type: "string" },
  },
  required: ["category", "scam_likelihood", "impersonates", "requested_action", "red_flags", "explanation"],
  additionalProperties: false,
};

const SYSTEM = [
  "You review SMS and chat messages received by someone in Kenya who uses M-Pesa and USDT.",
  "Decide whether the message is a scam attempt, which kind, and explain why in two short plain-English sentences.",
  "Genuine M-PESA confirmations come from the sender MPESA, start with a 10-character uppercase code followed by 'Confirmed.', and show the new balance.",
  "Messages may mix English, Swahili and Sheng. Only cite red flags that are actually in the message. /no_think",
].join(" ");

// Synthetic samples covering the main shapes: forged confirmation + reversal ask, PIN phishing,
// a genuine-looking M-PESA alert, a P2P "I paid" push, and an ordinary message.
const SAMPLES = [
  {
    sender: "0712345678",
    text: "UJ81KQ2ZT4 Confirmed. You have received Ksh3,500.00 from JOHN KAMAU 0798765432 on 27/10/26 at 6:14 PM New M-PESA balance is *LOCKED*",
  },
  { sender: "0712345678", text: "Sorry bro nimekosea kutuma, hiyo ni pesa ya karo. Tafadhali nirudishie 3,500 kwa hii namba haraka" },
  {
    sender: "0733000111",
    text: "Safaricom: Your line has been registered twice and will be suspended in 2 hours. Call this number and confirm your M-PESA PIN to keep your line active.",
  },
  {
    sender: "MPESA",
    text: "UJ84HD71PL Confirmed. Ksh1,200.00 sent to MARY WANJIKU on 27/10/26 at 9:02 AM. New M-PESA balance is Ksh8,431.50. Transaction cost, Ksh15.00.",
  },
  {
    sender: "P2P buyer (chat)",
    text: "I have already paid via M-Pesa, check the screenshot. Please release the USDT now, I am in a hurry. Let's continue on WhatsApp it's faster.",
  },
  { sender: "0722555444", text: "Hi Mum, I'll be home late today, the matatu is stuck in traffic on Thika Road." },
];

const loadStart = performance.now();
const modelId = await loadModel({ modelSrc: QWEN3_4B_INST_Q4_K_M });
console.log(`model loaded in ${((performance.now() - loadStart) / 1000).toFixed(1)}s`);

try {
  for (const sample of SAMPLES) {
    const started = performance.now();
    const run = completion({
      modelId,
      stream: false,
      history: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Sender: ${sample.sender}\nMessage: ${sample.text}` },
      ],
      responseFormat: { type: "json_schema", json_schema: { name: "verdict", schema: VERDICT_SCHEMA } },
    });
    const final = await run.final;
    const ms = performance.now() - started;
    const stats = final.stats ?? {};
    let verdict: unknown;
    try {
      verdict = JSON.parse(final.contentText.trim());
    } catch {
      verdict = { parse_error: final.contentText };
    }
    console.log(`\n[${sample.sender}] ${sample.text.slice(0, 70)}...`);
    console.log(
      `  ${ms.toFixed(0)} ms, ${stats.generatedTokens ?? "?"} tokens, ${stats.tokensPerSecond?.toFixed(1) ?? "?"} tok/s, device ${stats.backendDevice ?? "?"}`,
    );
    console.log(" ", JSON.stringify(verdict));
  }
} finally {
  await unloadModel({ modelId });
  void close();
}

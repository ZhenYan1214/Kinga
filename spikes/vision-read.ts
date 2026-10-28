// D3 spike: can Qwen3-VL 2B, on device, read a payment screenshot into fields the ledger can check?
// npm run spike:vision   (needs npm run spike:download-vision and npm run make:screenshots first)
import "./qvac-env.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { close, completion, loadModel, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K, QWEN3VL_2B_MULTIMODAL_Q4_K, unloadModel } from "@qvac/sdk";
import { SCREENSHOTS } from "../scripts/make-screenshots.js";

const DIR = fileURLToPath(new URL("../eval/data/screenshots/", import.meta.url));

const SCHEMA = {
  type: "object",
  properties: {
    transaction_code: { type: "string" },
    amount: { type: "number" },
    counterparty: { type: "string" },
    direction: { type: "string", enum: ["sent", "received", "unknown"] },
    date: { type: "string" },
    time: { type: "string" },
  },
  required: ["transaction_code", "amount", "counterparty", "direction", "date", "time"],
  additionalProperties: false,
};

const PROMPT = [
  "This is a screenshot of an M-PESA payment confirmation (an SMS or the M-PESA app).",
  "Copy the fields exactly as shown: the 10-character transaction code (also called Transaction ID), the amount as a number without Ksh or commas,",
  "the other party's name, whether money was sent or received, and the date and time. Do not guess; use an empty string if a field is not visible.",
].join(" ");

const loadStart = performance.now();
const modelId = await loadModel({
  modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K,
  modelConfig: { ctx_size: 4096, projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K },
});
console.log(`vision model loaded in ${((performance.now() - loadStart) / 1000).toFixed(1)}s`);

try {
  for (const shot of SCREENSHOTS) {
    const started = performance.now();
    const run = completion({
      modelId,
      stream: false,
      history: [{ role: "user", content: PROMPT, attachments: [{ path: join(DIR, shot.file) }] }],
      responseFormat: { type: "json_schema", json_schema: { name: "payment", schema: SCHEMA } },
    });
    const final = await run.final;
    const ms = performance.now() - started;
    let read: { transaction_code?: string; amount?: number; counterparty?: string; direction?: string } = {};
    try {
      read = JSON.parse(final.contentText.trim());
    } catch {
      console.log(`  ${shot.file}: not JSON: ${final.contentText.slice(0, 120)}`);
    }
    const ok = {
      code: read.transaction_code === shot.truth.code,
      amount: read.amount === shot.truth.amount,
      name: read.counterparty?.toUpperCase().trim() === shot.truth.counterparty,
      direction: read.direction === shot.truth.direction,
    };
    console.log(`\n${shot.file} (${shot.layout}) ${(ms / 1000).toFixed(1)}s ${Object.values(ok).every(Boolean) ? "ALL CORRECT" : ""}`);
    console.log(" ", JSON.stringify(read));
    console.log(" ", JSON.stringify(ok));
  }
} finally {
  await unloadModel({ modelId });
  void close();
}

// Reads a payment screenshot into fields, on device, with Qwen3-VL 2B. The model only reads; whether the
// payment is real is decided by core's ledger, never by the model.
import "./env.js";
import { completion, loadModel, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K, QWEN3VL_2B_MULTIMODAL_Q4_K, unloadModel } from "@qvac/sdk";

export interface ScreenshotFields {
  transaction_code: string;
  amount: number;
  counterparty: string;
  direction: "sent" | "received" | "unknown";
  date: string;
  time: string;
}

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

export class ScreenshotReader {
  private constructor(private readonly modelId: string) {}

  static async load(): Promise<ScreenshotReader> {
    const modelId = await loadModel({
      modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K,
      modelConfig: { ctx_size: 4096, projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K },
    });
    return new ScreenshotReader(modelId);
  }

  /** undefined when the model fails or returns something that is not the expected JSON. */
  async read(imagePath: string): Promise<{ fields: ScreenshotFields; ms: number } | undefined> {
    const started = performance.now();
    try {
      const run = completion({
        modelId: this.modelId,
        stream: false,
        history: [{ role: "user", content: PROMPT, attachments: [{ path: imagePath }] }],
        responseFormat: { type: "json_schema", json_schema: { name: "payment", schema: SCHEMA } },
        // Greedy decoding: reading is transcription, not creativity.
        generationParams: { temp: 0, seed: 7 },
      });
      const final = await run.final;
      const fields = JSON.parse(final.contentText.trim()) as ScreenshotFields;
      fields.transaction_code = fields.transaction_code.trim().toUpperCase();
      return { fields, ms: performance.now() - started };
    } catch {
      return undefined;
    }
  }

  async unload(): Promise<void> {
    await unloadModel({ modelId: this.modelId });
  }
}

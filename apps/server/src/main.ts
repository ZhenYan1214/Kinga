// Kinga's local service. Binds to 127.0.0.1 only. The model and every check run on this machine; the only
// outbound traffic is the two wallet network steps (/api/network/*), which the UI labels and the user triggers.
// npm run dev:server   (KINGA_NO_MODEL=1 skips the model for quick UI work)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { adviceFor, analyze, reasonInSwahili, checkAddress, checkRelease, fuse, MpesaLedger, type Message } from "@kinga/core";
import { KingaModel, ScreenshotReader, type ModelVerdict, type ScreenshotFields } from "@kinga/ai";
import { formatUnits, JsonRpc, KingaWallet, parseUnits } from "@kinga/wallet";
import { DEMO_INBOX, DEMO_ORDERS, type DemoOrder } from "./demo.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_DIST = join(ROOT, "apps/web/dist");
const PORT = Number(process.env.PORT ?? 8787);
const SEPOLIA_RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"];
const DECIMALS = 6;

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));
const seed = process.env.KINGA_TEST_SEED;
if (!seed) throw new Error("KINGA_TEST_SEED missing from .env; run npm run spike:wdk once to create a test seed");
const tokenAddress = process.env.KINGA_USDT_ADDRESS;

// ---- model (on device) ----
let model: KingaModel | undefined;
let modelStatus: "disabled" | "loading" | "ready" | "failed" = process.env.KINGA_NO_MODEL ? "disabled" : "loading";
// Requests that arrive while the model loads wait for it instead of silently getting rules-only verdicts.
const modelReady: Promise<void> =
  modelStatus === "loading"
    ? KingaModel.load().then(
        (m) => void ((model = m), (modelStatus = "ready"), console.log("model ready")),
        (error) => void ((modelStatus = "failed"), console.error("model failed to load:", error)),
      )
    : Promise.resolve();
// The screenshot reader (Qwen3-VL 2B) loads alongside; it only reads, the ledger decides.
let reader: ScreenshotReader | undefined;
let readerStatus: "disabled" | "loading" | "ready" | "failed" = process.env.KINGA_NO_MODEL ? "disabled" : "loading";
const readerReady: Promise<void> =
  readerStatus === "loading"
    ? ScreenshotReader.load().then(
        (r) => void ((reader = r), (readerStatus = "ready"), console.log("screenshot reader ready")),
        (error) => void ((readerStatus = "failed"), console.error("screenshot reader failed to load:", error)),
      )
    : Promise.resolve();
// One model call at a time.
let modelQueue: Promise<unknown> = Promise.resolve();
const serialized = <T>(task: () => Promise<T>): Promise<T> => {
  const run = modelQueue.then(task, task);
  modelQueue = run.catch(() => undefined);
  return run;
};

// ---- wallet ----
const wallet = await KingaWallet.open({
  seed,
  chainId: 11155111,
  tokenAddress: tokenAddress ?? "0x0000000000000000000000000000000000000000",
  tokenDecimals: DECIMALS,
  perTransactionCap: parseUnits("200", DECIMALS),
  dailyBudget: parseUnits("500", DECIMALS),
  // KINGA_STATE lets the offline proof run against its own ledger.
  statePath: process.env.KINGA_STATE ?? join(ROOT, ".kinga/wallet-state.json"),
});
const rpc = new JsonRpc(SEPOLIA_RPCS);

// Demo buyers are other accounts on the same test seed.
const derive = new WDK(seed).registerWallet("derive", WalletManagerEvm, { chainId: 11155111 });
const buyerAddress = new Map<string, string>();
for (const order of DEMO_ORDERS) {
  const account = await derive.getAccount("derive", order.buyerAccount);
  buyerAddress.set(order.id, await account.getAddress());
  if (order.repeatBuyer) wallet.allow(`${order.buyerKycName} (repeat buyer)`, buyerAddress.get(order.id)!);
}
derive.dispose();

/** A look-alike of a saved address: same first and last four characters, different middle. */
function poisoned(address: string): string {
  const middle = [...address.slice(6, -4)].map((c) => ((parseInt(c, 16) + 7) % 16).toString(16)).join("");
  return `${address.slice(0, 6)}${middle}${address.slice(-4)}`;
}

// ---- verdicts ----
interface Verdict {
  level: string;
  category: string;
  decidedBy: string;
  signals: { id: string; strength: string; evidence: string; reason: string; reasonSw: string }[];
  advice: string[];
  adviceSw: string[];
  model?: (ModelVerdict & { ms: number }) | undefined;
  modelNote?: string;
}

const verdictCache = new Map<string, Verdict>();
// The seller's own M-PESA history: the ground truth for every "I paid you" and "I sent it by mistake".
const LEDGER = new MpesaLedger(DEMO_INBOX);

async function verdictFor(message: Message, useModel: boolean): Promise<Verdict> {
  const rules = analyze(message, { ledger: LEDGER });
  let modelView: Verdict["model"];
  let modelNote: string | undefined;
  if (useModel) await modelReady;
  if (useModel && model) {
    const assessment = await serialized(() => model!.assess(message, rules.signals));
    if (assessment.verdict) modelView = { ...assessment.verdict, ms: Math.round(assessment.ms) };
    else modelNote = "The on-device model did not answer; this verdict is from the rules alone.";
  } else if (useModel) {
    modelNote = modelStatus === "loading" ? "The on-device model is still loading; rules only for now." : `Model ${modelStatus}; rules only.`;
  }
  const fused = fuse(rules, modelView);
  return {
    level: fused.level,
    category: fused.category,
    decidedBy: fused.decidedBy,
    signals: fused.signals.map((s) => ({ ...s, reasonSw: reasonInSwahili(s) })),
    advice: adviceFor(fused.category, fused.level),
    adviceSw: adviceFor(fused.category, fused.level, "sw"),
    model: modelView,
    modelNote,
  };
}

function orderView(order: DemoOrder) {
  const to = buyerAddress.get(order.id)!;
  return { ...order, buyerAddress: to, lookalikeAddress: poisoned(to) };
}

// ---- screenshots ----
const SCREENSHOT_DIR = join(ROOT, "eval/data/screenshots");
const UPLOAD_DIR = join(ROOT, ".kinga/uploads");
const screenshotCache = new Map<string, { fields: ScreenshotFields; ms: number }>();

/** Reads a screenshot on device; cached per file. undefined when the reader is unavailable or fails. */
async function readScreenshot(path: string) {
  const cached = screenshotCache.get(path);
  if (cached) return cached;
  await readerReady;
  if (!reader) return undefined;
  const result = await serialized(() => reader!.read(path));
  if (result) screenshotCache.set(path, { fields: result.fields, ms: Math.round(result.ms) });
  return result && screenshotCache.get(path);
}

/** The buyer's claim: read from their screenshot when possible, otherwise the code they typed. */
async function claimFor(order: DemoOrder) {
  const screenshot = await readScreenshot(join(SCREENSHOT_DIR, order.screenshot));
  return { code: screenshot?.fields.transaction_code || order.claimedCode, screenshot };
}

async function releaseInputs(orderId: string, to: string) {
  const order = DEMO_ORDERS.find((o) => o.id === orderId);
  if (!order) throw new HttpError(404, `no order ${orderId}`);
  const claim = await claimFor(order);
  const receiptCheck = checkRelease(
    { amountKsh: order.amountKsh, buyerKycName: order.buyerKycName, claimedCode: claim.code },
    DEMO_INBOX,
    wallet.usedMpesaCodes(),
  );
  const addressVerdict = checkAddress(to, "evm", wallet.allowlist);
  return { order, claim, receiptCheck, addressVerdict, amount: parseUnits(order.usdt, DECIMALS) };
}

function walletView() {
  return {
    address: wallet.address,
    tokenConfigured: Boolean(tokenAddress),
    snapshot: wallet.snapshot,
    spentLast24h: formatUnits(wallet.spentLast24h(), DECIMALS),
    dailyBudget: "500",
    perTransactionCap: "200",
    allowlist: wallet.allowlist,
    releases: wallet.releases.map(({ raw, ...r }) => ({ ...r, amount: formatUnits(BigInt(r.amount), DECIMALS), rawPreview: `${raw.slice(0, 26)}…` })),
  };
}

// ---- http ----
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const send = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};

type Handler = (req: IncomingMessage, params: string[]) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/status$/, async () => ({ model: modelStatus, reader: readerStatus, wallet: walletView() })],
  ["GET", /^\/api\/inbox$/, async () => DEMO_INBOX.map((m) => ({ ...m, verdict: verdictCache.get(m.id) ?? null }))],
  [
    "POST",
    /^\/api\/inbox\/(\w+)\/analyze$/,
    async (_req, [id]) => {
      const message = DEMO_INBOX.find((m) => m.id === id);
      if (!message) throw new HttpError(404, `no message ${id}`);
      const cached = verdictCache.get(message.id);
      if (cached?.model) return cached;
      const verdict = await verdictFor(message, true);
      verdictCache.set(message.id, verdict);
      return verdict;
    },
  ],
  [
    "POST",
    /^\/api\/analyze$/,
    async (req) => {
      const { channel = "sms", sender = "", contact = null, text = "" } = (await body(req)) as Partial<Message>;
      if (!String(text).trim()) throw new HttpError(400, "text is required");
      return verdictFor({ channel, sender: String(sender), contact: contact ? String(contact) : null, text: String(text) }, true);
    },
  ],
  [
    "GET",
    /^\/api\/ledger$/,
    // The seller's M-PESA history in time order, with what the balance chain says about each message.
    async () =>
      LEDGER.entries.map((e) => {
        const check = LEDGER.check(e.message);
        const item = DEMO_INBOX.find((m) => m === e.message);
        return {
          id: item?.id,
          time: item?.time,
          code: e.receipt.code,
          kind: e.receipt.kind,
          counterparty: e.receipt.counterparty,
          amount: e.receipt.amount,
          delta: e.delta,
          balance: e.balance,
          status: check.status,
          reason: check.reason,
        };
      }),
  ],
  ["GET", /^\/api\/orders$/, async () => DEMO_ORDERS.map(orderView)],
  [
    "POST",
    /^\/api\/release\/check$/,
    async (req) => {
      const { orderId, to } = (await body(req)) as { orderId: string; to: string };
      const { order, claim, receiptCheck, addressVerdict, amount } = await releaseInputs(orderId, to);
      const chat = await verdictFor({ channel: "p2p_chat", sender: "P2P buyer", contact: null, text: order.chat.join("\n") }, true);
      const gate = await wallet.preview({ orderId, mpesaCode: receiptCheck.receipt?.code ?? claim.code, to, amount, receiptCheck, addressVerdict });
      return { claim, receiptCheck, addressVerdict, chat, gate };
    },
  ],
  [
    "POST",
    /^\/api\/verify$/,
    async (req) => {
      // "Did they really pay?": read a payment screenshot on device, then check it against the ledger.
      const { image, orderId, amountKsh, buyerName } = (await body(req)) as { image?: string; orderId?: string; amountKsh?: number; buyerName?: string };
      let path: string;
      const order = orderId ? DEMO_ORDERS.find((o) => o.id === orderId) : undefined;
      if (orderId) {
        if (!order) throw new HttpError(404, `no order ${orderId}`);
        path = join(SCREENSHOT_DIR, order.screenshot);
      } else {
        const match = image?.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
        if (!match) throw new HttpError(400, "Send a PNG, JPEG or WebP screenshot.");
        const bytes = Buffer.from(match[2]!, "base64");
        mkdirSync(UPLOAD_DIR, { recursive: true });
        path = join(UPLOAD_DIR, `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${match[1] === "jpg" ? "jpeg" : match[1]}`);
        writeFileSync(path, bytes);
      }
      const screenshot = await readScreenshot(path);
      if (!screenshot) throw new HttpError(503, `The screenshot reader is ${readerStatus}; it could not read this image.`);
      // The transaction code is what gets looked up; the amount to expect comes from the order or the user, and
      // only falls back to what the reader saw (a misread amount must not decide anything on its own).
      const check = checkRelease(
        {
          amountKsh: order?.amountKsh ?? (Number(amountKsh) || screenshot.fields.amount),
          buyerKycName: order?.buyerKycName ?? (buyerName || undefined),
          claimedCode: screenshot.fields.transaction_code,
        },
        DEMO_INBOX,
        wallet.usedMpesaCodes(),
      );
      return { screenshot, check };
    },
  ],
  [
    "POST",
    /^\/api\/release\/confirm$/,
    async (req) => {
      const { orderId, to, humanApproved } = (await body(req)) as { orderId: string; to: string; humanApproved: boolean };
      const { order, receiptCheck, addressVerdict, amount } = await releaseInputs(orderId, to);
      const outcome = await wallet.release({
        orderId,
        mpesaCode: receiptCheck.receipt?.code ?? order.claimedCode,
        to,
        amount,
        receiptCheck,
        addressVerdict,
        humanApproved: humanApproved === true,
      });
      return { outcome: outcome.ok ? { ok: true, nonce: outcome.record.nonce, rawPreview: `${outcome.record.raw.slice(0, 26)}…` } : outcome, wallet: walletView() };
    },
  ],
  [
    "POST",
    /^\/api\/allowlist$/,
    async (req) => {
      const { label, address } = (await body(req)) as { label: string; address: string };
      wallet.allow(String(label || "Saved address"), String(address));
      return walletView();
    },
  ],
  [
    "POST",
    /^\/api\/network\/snapshot$/,
    async () => {
      const balances = await wallet.refreshSnapshot(rpc);
      return { eth: formatUnits(balances.eth, 18), usdt: tokenAddress ? formatUnits(balances.usdt, DECIMALS) : null, wallet: walletView() };
    },
  ],
  [
    "POST",
    /^\/api\/network\/broadcast$/,
    async () => {
      if (!tokenAddress) throw new HttpError(400, "Set KINGA_USDT_ADDRESS in .env to the Sepolia test USDT contract before broadcasting.");
      const sent = await wallet.broadcastPending(rpc);
      await wallet.confirmPending(rpc);
      return { sent: sent.map((r) => r.txHash), wallet: walletView() };
    },
  ],
];

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function serveStatic(path: string, res: ServerResponse) {
  const file = normalize(join(WEB_DIST, path === "/" ? "index.html" : path));
  const target = file.startsWith(WEB_DIST) && existsSync(file) ? file : join(WEB_DIST, "index.html");
  if (!existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("UI not built: run npm run build:web (or use npm run dev:web).");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
  res.end(readFileSync(target));
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    // The demo orders' payment screenshots, for the UI to show next to what the reader extracted.
    const shot = path.match(/^\/api\/screenshots\/([\w-]+\.png)$/)?.[1];
    if (shot && DEMO_ORDERS.some((o) => o.screenshot === shot)) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(readFileSync(join(SCREENSHOT_DIR, shot)));
    }
    for (const [method, pattern, handler] of routes) {
      const match = path.match(pattern);
      if (match && req.method === method) return send(res, 200, await handler(req, match.slice(1)));
    }
    if (path.startsWith("/api/")) throw new HttpError(404, `no route ${req.method} ${path}`);
    serveStatic(path, res);
  } catch (error) {
    send(res, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Kinga on http://127.0.0.1:${PORT} (model ${modelStatus})`));

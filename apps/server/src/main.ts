// Kinga's local service. Binds to 127.0.0.1 only. The model and every check run on this machine; the only
// outbound traffic is the two wallet network steps (/api/network/*), which the UI labels and the user triggers.
// npm run dev:server   (KINGA_NO_MODEL=1 skips the model for quick UI work)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { adviceFor, analyze, reasonInSwahili, checkAddress, checkRelease, fuse, MpesaLedger, parseSmsBackup, type Message } from "@kinga/core";
import { KingaModel, ScreenshotReader, type ModelVerdict, type ScreenshotFields } from "@kinga/ai";
import { formatUnits, JsonRpc, KingaWallet, parseUnits } from "@kinga/wallet";
import { DEMO_CLAIMS, DEMO_INBOX, DEMO_ORDERS, type DemoOrder, type InboxItem } from "./demo.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_DIST = join(ROOT, "apps/web/dist");
const PORT = Number(process.env.PORT ?? 8787);
const SEPOLIA_RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"];
const DECIMALS = 6;

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));
const seed = process.env.KINGA_TEST_SEED;
if (!seed) console.log("No KINGA_TEST_SEED in .env: the optional USDT release is off (npm run spike:wdk turns it on).");
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

// ---- wallet (optional: the USDT release needs a test seed, everything else does not) ----
const rpc = new JsonRpc(SEPOLIA_RPCS);
const buyerAddress = new Map<string, string>();

async function openWallet(seed: string) {
  const opened = await KingaWallet.open({
    seed,
    chainId: 11155111,
    tokenAddress: tokenAddress ?? "0x0000000000000000000000000000000000000000",
    tokenDecimals: DECIMALS,
    perTransactionCap: parseUnits("200", DECIMALS),
    dailyBudget: parseUnits("500", DECIMALS),
    // KINGA_STATE lets the offline proof run against its own ledger.
    statePath: process.env.KINGA_STATE ?? join(ROOT, ".kinga/wallet-state.json"),
  });
  // Demo buyers are other accounts on the same test seed.
  const derive = new WDK(seed).registerWallet("derive", WalletManagerEvm, { chainId: 11155111 });
  for (const order of DEMO_ORDERS) {
    const account = await derive.getAccount("derive", order.buyerAccount);
    buyerAddress.set(order.id, await account.getAddress());
    if (order.repeatBuyer) opened.allow(`${order.buyerKycName} (repeat buyer)`, buyerAddress.get(order.id)!);
  }
  derive.dispose();
  return opened;
}
const wallet = seed ? await openWallet(seed) : undefined;

/** The wallet, for the release routes; without a test seed they answer 503 and the rest of Kinga works as usual. */
function needWallet(): KingaWallet {
  if (!wallet) throw new HttpError(503, "The USDT release is optional and off: run npm run spike:wdk once to create a test wallet, then restart.");
  return wallet;
}

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

// The inbox Kinga checks against: the demo data, or the user's own SMS export (kept in memory, never written to
// disk). Its MPESA messages are the ground truth for every "I paid you" and "I sent it by mistake".
let inbox: { source: "demo" | "imported"; items: InboxItem[]; ledger: MpesaLedger } = {
  source: "demo",
  items: DEMO_INBOX,
  ledger: new MpesaLedger(DEMO_INBOX),
};
function useInbox(source: "demo" | "imported", items: InboxItem[]) {
  inbox = { source, items, ledger: new MpesaLedger(items) };
  verdictCache.clear();
}
/** The inbox page checks only the newest messages; a full phone export can hold thousands. */
const INBOX_PAGE = 30;

async function verdictFor(message: Message, useModel: boolean): Promise<Verdict> {
  const rules = analyze(message, { ledger: inbox.ledger });
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
/** When each transaction code was first checked here, so the same proof shown twice is noticed. Memory only. */
const firstChecked = new Map<string, string>();

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
    inbox.items,
    needWallet().usedMpesaCodes(),
  );
  const addressVerdict = checkAddress(to, "evm", needWallet().allowlist);
  return { order, claim, receiptCheck, addressVerdict, amount: parseUnits(order.usdt, DECIMALS) };
}

function walletView() {
  const wallet = needWallet();
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
  [
    "GET",
    /^\/api\/status$/,
    async () => ({ model: modelStatus, reader: readerStatus, inbox: { source: inbox.source, messages: inbox.items.length, mpesa: inbox.ledger.entries.length }, wallet: wallet ? walletView() : null }),
  ],
  ["GET", /^\/api\/claims$/, async () => DEMO_CLAIMS],
  [
    "GET",
    /^\/api\/inbox$/,
    async () => inbox.items.slice(-INBOX_PAGE).reverse().map((m) => ({ ...m, verdict: verdictCache.get(m.id) ?? null })),
  ],
  [
    "POST",
    /^\/api\/inbox\/import$/,
    async (req) => {
      const { xml } = (await body(req)) as { xml?: string };
      let sms;
      try {
        sms = parseSmsBackup(String(xml ?? ""));
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      const items: InboxItem[] = sms.map((m, i) => ({
        ...m,
        id: `s${i}`,
        time: new Date(m.receivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
      }));
      useInbox("imported", items);
      return { source: inbox.source, messages: items.length, mpesa: inbox.ledger.entries.length };
    },
  ],
  [
    "POST",
    /^\/api\/inbox\/demo$/,
    async () => {
      useInbox("demo", DEMO_INBOX);
      return { source: inbox.source, messages: DEMO_INBOX.length, mpesa: inbox.ledger.entries.length };
    },
  ],
  [
    "POST",
    /^\/api\/inbox\/(\w+)\/analyze$/,
    async (_req, [id]) => {
      const message = inbox.items.find((m) => m.id === id);
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
      inbox.ledger.entries.map((e) => {
        const check = inbox.ledger.check(e.message);
        const item = inbox.items.find((m) => m === e.message);
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
  ["GET", /^\/api\/orders$/, async () => (needWallet(), DEMO_ORDERS.map(orderView))],
  [
    "POST",
    /^\/api\/release\/check$/,
    async (req) => {
      const { orderId, to } = (await body(req)) as { orderId: string; to: string };
      const { order, claim, receiptCheck, addressVerdict, amount } = await releaseInputs(orderId, to);
      const chat = await verdictFor({ channel: "p2p_chat", sender: "P2P buyer", contact: null, text: order.chat.join("\n") }, true);
      const gate = await needWallet().preview({ orderId, mpesaCode: receiptCheck.receipt?.code ?? claim.code, to, amount, receiptCheck, addressVerdict });
      return { claim, receiptCheck, addressVerdict, chat, gate };
    },
  ],
  [
    "POST",
    /^\/api\/verify$/,
    async (req) => {
      // "Did they really pay?": read a payment screenshot on device, then check it against the ledger.
      const { image, claimId, amountKsh, buyerName, code } = (await body(req)) as {
        image?: string;
        claimId?: string;
        amountKsh?: number;
        buyerName?: string;
        code?: string;
      };
      let path: string;
      const claim = claimId ? DEMO_CLAIMS.find((c) => c.id === claimId) : undefined;
      if (claimId) {
        if (!claim) throw new HttpError(404, `no demo claim ${claimId}`);
        path = join(SCREENSHOT_DIR, claim.screenshot);
      } else {
        const match = image?.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
        if (!match) throw new HttpError(400, "Send a PNG, JPEG or WebP screenshot.");
        const bytes = Buffer.from(match[2]!, "base64");
        mkdirSync(UPLOAD_DIR, { recursive: true });
        path = join(UPLOAD_DIR, `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${match[1] === "jpg" ? "jpeg" : match[1]}`);
        writeFileSync(path, bytes);
      }
      // An uploaded proof is deleted as soon as it has been read; only the extracted fields stay, in memory.
      const screenshot = await readScreenshot(path).finally(() => !claimId && rmSync(path, { force: true }));
      if (!screenshot) {
        const why = { loading: "is still loading", failed: "failed to load", disabled: "is turned off", ready: "could not read this image" }[readerStatus];
        throw new HttpError(503, `The on-device screenshot reader ${why}. Try again, or check the payment in your M-PESA app.`);
      }
      // The transaction code is what gets looked up; the amount to expect comes from the order or the user, and
      // only falls back to what the reader saw. A misread amount must not decide anything on its own, so the UI
      // turns a mismatch against the reader's amount into "compare it yourself", never "edited proof".
      const expected = claim?.expectsKsh ?? (Number(amountKsh) || undefined);
      // Without a code there is nothing to look up: matching on the amount alone would accept any old payment.
      const claimedCode = String(code ?? "").replace(/\s/g, "").toUpperCase() || screenshot.fields.transaction_code;
      if (!claimedCode) {
        throw new HttpError(422, "The transaction code is not readable on this picture. Type the 10-character code from the proof (like UJ7M2QK8TA) and check again.");
      }
      const check = checkRelease(
        {
          amountKsh: expected ?? screenshot.fields.amount,
          buyerKycName: claim?.payerName ?? (buyerName || undefined),
          claimedCode,
        },
        inbox.items,
        wallet?.usedMpesaCodes(),
      );
      const seen = check.receipt?.code ? firstChecked.get(check.receipt.code) : undefined;
      if (check.receipt?.code && !seen) firstChecked.set(check.receipt.code, new Date().toISOString());
      return {
        screenshot,
        check,
        code: claimedCode,
        amountFrom: expected === undefined ? "screenshot" : claim ? "claim" : "user",
        expectedKsh: expected ?? screenshot.fields.amount,
        firstCheckedAt: seen,
      };
    },
  ],
  [
    "POST",
    /^\/api\/release\/confirm$/,
    async (req) => {
      const { orderId, to, humanApproved } = (await body(req)) as { orderId: string; to: string; humanApproved: boolean };
      const { order, receiptCheck, addressVerdict, amount } = await releaseInputs(orderId, to);
      const outcome = await needWallet().release({
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
      needWallet().allow(String(label || "Saved address"), String(address));
      return walletView();
    },
  ],
  [
    "POST",
    /^\/api\/network\/snapshot$/,
    async () => {
      const balances = await needWallet().refreshSnapshot(rpc);
      return { eth: formatUnits(balances.eth, 18), usdt: tokenAddress ? formatUnits(balances.usdt, DECIMALS) : null, wallet: walletView() };
    },
  ],
  [
    "POST",
    /^\/api\/network\/broadcast$/,
    async () => {
      if (!tokenAddress) throw new HttpError(400, "Set KINGA_USDT_ADDRESS in .env to the Sepolia test USDT contract before broadcasting.");
      const sent = await needWallet().broadcastPending(rpc);
      await needWallet().confirmPending(rpc);
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

// Only this machine's own pages may talk to Kinga: a Host check stops DNS rebinding, an Origin check stops other
// web pages (the inbox can hold OTPs, and the release routes sign transactions). 5173 is the Vite dev server.
const LOCAL_HOSTS = new Set([PORT, 5173].flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
const fromThisMachine = (req: IncomingMessage) => {
  const origin = req.headers.origin;
  return LOCAL_HOSTS.has(req.headers.host ?? "") && (!origin || LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, "")));
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!fromThisMachine(req)) return send(res, 403, { error: "Kinga only answers pages served from this machine." });
  try {
    // The demo orders' payment screenshots, for the UI to show next to what the reader extracted.
    const shot = path.match(/^\/api\/screenshots\/([\w-]+\.png)$/)?.[1];
    if (shot && DEMO_CLAIMS.some((c) => c.screenshot === shot)) {
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

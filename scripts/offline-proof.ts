// Offline proof: starts Kinga, runs both demo acts through the local API, and watches every TCP connection
// owned by the Kinga process tree (Node server, tsx, QVAC's Bare worker). Any non-loopback connection is a failure.
//
//   npm run offline-proof                   network may be on: proves the flow makes no outbound connections
//   npm run offline-proof -- --wait-offline start it, then turn Wi-Fi off; it runs once the internet is gone
//   npm run offline-proof -- --control      positive control: also runs a network step, which the monitor must catch
//
// Windows only for now (netstat -ano and Win32_Process). Limits, stated in the report too: connections are sampled
// every 300 ms, so one that opens and closes in between could be missed; DNS lookups go through the Windows
// DNS Client service, not our processes, so they cannot be attributed. The airplane-mode recording covers both.
import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const { values } = parseArgs({ options: { "wait-offline": { type: "boolean", default: false }, control: { type: "boolean", default: false } } });

if (process.platform !== "win32") throw new Error("offline-proof currently samples connections with Windows tools only");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)} s`;

async function internetReachable(): Promise<boolean> {
  for (const url of ["https://www.google.com", "https://1.1.1.1"]) {
    try {
      await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      // try the next one
    }
  }
  return false;
}

// ---- process tree and connections ----

async function processTree(rootPid: number): Promise<Map<number, string>> {
  const { stdout } = await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.Name)\" }",
  ]);
  const children = new Map<number, { pid: number; name: string }[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, parent, ...name] = line.trim().split(" ");
    if (!pid || !parent) continue;
    const list = children.get(Number(parent)) ?? [];
    list.push({ pid: Number(pid), name: name.join(" ") });
    children.set(Number(parent), list);
  }
  const tree = new Map<number, string>([[rootPid, "server"]]);
  const queue = [rootPid];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (!tree.has(child.pid)) {
        tree.set(child.pid, child.name);
        queue.push(child.pid);
      }
    }
  }
  return tree;
}

const LOOPBACK = /^(?:127\.|\[?::1\]?|0\.0\.0\.0|\[?::\]?|\*)/;

interface Connection {
  at: string;
  pid: number;
  process: string;
  local: string;
  remote: string;
  state: string;
}

async function outboundConnections(tree: Map<number, string>): Promise<Connection[]> {
  const { stdout } = await run("netstat", ["-ano", "-p", "TCP"]);
  const found: Connection[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "TCP" || parts.length < 5) continue;
    const [, local, remote, state, pid] = parts as [string, string, string, string, string];
    if (!tree.has(Number(pid)) || LOOPBACK.test(remote)) continue;
    found.push({ at: new Date().toISOString(), pid: Number(pid), process: tree.get(Number(pid))!, local, remote, state });
  }
  return found;
}

// ---- the flow ----

async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${path}: ${data.error ?? response.status}`);
  return data;
}

async function main() {
  const started = Date.now();
  const log: string[] = [];
  const note = (line: string) => (console.log(line), log.push(line));

  if (values["wait-offline"]) {
    note("Waiting for the internet to go away: turn off Wi-Fi now (gives up after 30 minutes).");
    const deadline = Date.now() + 30 * 60_000;
    while (await internetReachable()) {
      if (Date.now() > deadline) throw new Error("the internet never went away");
      await sleep(3000);
    }
  }
  const onlineAtStart = await internetReachable();
  note(`Internet reachable at start: ${onlineAtStart ? "yes" : "no"}`);

  // A ledger for this run only, with a placeholder nonce/fee snapshot so a release can be signed without going online.
  const statePath = join(ROOT, ".kinga/proof-state.json");
  mkdirSync(join(ROOT, ".kinga"), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify({ allowlist: [], releases: [], snapshot: { nonce: 0, maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000", takenAt: new Date().toISOString() } }),
  );

  const server = spawn(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), join(ROOT, "apps/server/src/main.ts")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), KINGA_STATE: statePath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  // Monitor: refresh the process tree every 2 s, sample connections every 300 ms.
  let tree = new Map<number, string>([[server.pid!, "server"]]);
  const seen = new Map<string, Connection>();
  const processNames = new Set<string>();
  let samples = 0;
  let monitoring = true;
  const treeLoop = (async () => {
    while (monitoring) {
      tree = await processTree(server.pid!).catch(() => tree);
      for (const name of tree.values()) processNames.add(name);
      await sleep(2000);
    }
  })();
  const sampleLoop = (async () => {
    while (monitoring) {
      for (const c of await outboundConnections(tree).catch(() => [])) seen.set(`${c.pid}|${c.remote}`, c);
      samples++;
      await sleep(300);
    }
  })();

  const steps: string[] = [];
  let failure: string | undefined;
  try {
    // Wait for the server, then for the model to finish loading from the local cache.
    for (let i = 0; ; i++) {
      try {
        const status = await api<{ model: string }>("GET", "/api/status");
        if (status.model === "ready") break;
        if (status.model === "failed") throw new Error("model failed to load");
      } catch (error) {
        if ((error as Error).message === "model failed to load") throw error;
      }
      if (i > 240) throw new Error("server or model not ready after 2 minutes");
      await sleep(500);
    }
    steps.push(`Model loaded from the local cache: ready ${elapsed(started)} after start`);

    const inbox = await api<{ id: string; sender: string }[]>("GET", "/api/inbox");
    for (const message of inbox) {
      const t = Date.now();
      const verdict = await api<{ level: string; category: string; model?: unknown }>("POST", `/api/inbox/${message.id}/analyze`);
      steps.push(`Act 1 ${message.id} (${message.sender}): ${verdict.level} / ${verdict.category}${verdict.model ? "" : " [no model answer]"} in ${elapsed(t)}`);
    }

    const orders = await api<{ id: string; buyerAddress: string }[]>("GET", "/api/orders");
    for (const order of orders) {
      const t = Date.now();
      const check = await api<{ gate: { ok: boolean; stage?: string; reasons?: string[] }; chat: { level: string } }>("POST", "/api/release/check", {
        orderId: order.id,
        to: order.buyerAddress,
      });
      steps.push(`Act 2 ${order.id}: ${check.gate.ok ? "all checks pass" : `blocked at ${check.gate.stage}`}; chat ${check.chat.level}; ${elapsed(t)}`);
      if (check.gate.ok) {
        const confirm = await api<{ outcome: { ok: boolean; nonce?: number; reasons?: string[] } }>("POST", "/api/release/confirm", {
          orderId: order.id,
          to: order.buyerAddress,
          humanApproved: true,
        });
        steps.push(`Act 2 ${order.id}: ${confirm.outcome.ok ? `signed offline (nonce ${confirm.outcome.nonce}), queued, not broadcast` : `not signed: ${confirm.outcome.reasons?.join(" ")}`}`);
      }
    }
    if (values.control) {
      // Deliberately use the network so the run shows the monitor does see connections when they happen.
      await api("POST", "/api/network/snapshot");
      steps.push("Control: ran the wallet's 'read nonce and fees' network step on purpose");
    }
  } catch (error) {
    failure = (error as Error).message;
  } finally {
    await sleep(1000); // one more round of samples after the last request
    monitoring = false;
    await Promise.all([treeLoop, sampleLoop]);
    await run("taskkill", ["/pid", String(server.pid), "/T", "/F"]).catch(() => undefined);
  }

  const onlineAtEnd = await internetReachable();
  const connections = [...seen.values()];
  // In control mode the run passes only if the monitor caught the deliberate network step.
  const passed = !failure && (values.control ? connections.length > 0 : connections.length === 0);

  const report = [
    `# Kinga offline proof${values.control ? " (positive control)" : ""}: ${passed ? "PASS" : "FAIL"}`,
    "",
    `Run ${new Date(started).toISOString()}, ${elapsed(started)} in total. Mode: ${values.control ? "positive control, a network step was run on purpose and must be seen" : values["wait-offline"] ? "waited for the internet to go away" : "network left as it was"}.`,
    "",
    `- Internet reachable at start: **${onlineAtStart ? "yes" : "no"}**; at end: **${onlineAtEnd ? "yes" : "no"}**`,
    `- Processes watched (the server and everything it started): ${[...processNames].sort().join(", ")}`,
    `- Connection samples taken: ${samples} (every 300 ms)`,
    `- Non-loopback TCP connections from those processes: **${connections.length}**`,
    ...(failure ? [`- The flow failed: ${failure}`] : []),
    "",
    "## Steps",
    "",
    ...steps.map((s) => `- ${s}`),
    "",
    ...(connections.length
      ? ["## Connections seen", "", "| time | process | pid | local port | remote | state |", "|---|---|---|---|---|---|", ...connections.map((c) => `| ${c.at} | ${c.process} | ${c.pid} | :${c.local.split(":").pop()} | ${c.remote} | ${c.state} |`), ""]
      : []),
    "## Limits",
    "",
    "- Connections are sampled every 300 ms; one that opens and closes between samples could be missed.",
    "- DNS lookups go through the Windows DNS Client service, not Kinga's processes, so they are not attributed here.",
    "- The wallet's two network steps (reading the nonce, broadcasting) are deliberately not part of this run.",
    "- The airplane-mode recording of the demo is the complementary proof for both limits.",
  ].join("\n");

  mkdirSync(join(ROOT, "eval/reports"), { recursive: true });
  const file = join(ROOT, `eval/reports/offline-proof${values.control ? "-control" : ""}-${new Date(started).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`);
  writeFileSync(file, report);
  console.log(`\n${report}\n\nreport: ${file}`);
  process.exitCode = passed ? 0 : 1;
}

await main();

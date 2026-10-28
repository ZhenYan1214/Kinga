// Scores Kinga on the labelled dataset in three modes: rules only, model only, and fused (rules + model).
// npm run eval -- --split dev [--modes rules,llm,fused] [--limit 20]
// Tune only on dev; report test.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { analyze, fuse, LLM_LEVEL, type Category, type Channel, type RiskLevel, type SignalId } from "@kinga/core";
import { KingaModel, type Assessment } from "@kinga/ai";

interface Item {
  id: string;
  split: "dev" | "test";
  channel: Channel;
  sender: string;
  contact: string | null;
  text: string;
  label: "scam" | "benign";
  category: Category;
  lang: "en" | "sw" | "sheng" | "mixed";
  expected_signals: string[];
  note: string;
}

type Mode = "rules" | "llm" | "fused";

interface Prediction {
  id: string;
  mode: Mode;
  level: RiskLevel;
  category: Category;
  signals: SignalId[];
  ms?: number;
  jsonValid?: boolean;
  explanation?: string;
}

const { values } = parseArgs({
  options: {
    split: { type: "string", default: "dev" },
    modes: { type: "string", default: "rules,llm,fused" },
    limit: { type: "string" },
    data: { type: "string", default: "eval/data/kenya-v1.jsonl" },
  },
});

const modes = values.modes!.split(",") as Mode[];
let items = readFileSync(values.data!, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Item)
  .filter((i) => values.split === "all" || i.split === values.split);
if (values.limit) items = items.slice(0, Number(values.limit));
console.log(`${items.length} items (split ${values.split}), modes ${modes.join(", ")}`);

const predictions: Prediction[] = [];
const model = modes.some((m) => m !== "rules") ? await KingaModel.load() : undefined;

try {
  for (const [n, item] of items.entries()) {
    const message = { channel: item.channel, sender: item.sender, contact: item.contact, text: item.text };
    const rules = analyze(message);
    const signals = rules.signals.map((s) => s.id);
    if (modes.includes("rules")) predictions.push({ id: item.id, mode: "rules", level: rules.level, category: rules.category, signals });

    const record = (mode: Mode, a: Assessment, level: RiskLevel, category: Category) =>
      predictions.push({ id: item.id, mode, level, category, signals, ms: a.ms, jsonValid: a.verdict !== undefined, explanation: a.verdict?.explanation });

    if (model && modes.includes("llm")) {
      const a = await model.assess(message);
      const level = a.verdict ? LLM_LEVEL[a.verdict.scam_likelihood] : "safe";
      record("llm", a, level, level === "safe" ? "not_scam" : (a.verdict?.category ?? "not_scam"));
    }
    if (model && modes.includes("fused")) {
      const a = await model.assess(message, rules.signals);
      const fused = fuse(rules, a.verdict);
      record("fused", a, fused.level, fused.category);
    }
    if ((n + 1) % 10 === 0) console.log(`  ${n + 1}/${items.length}`);
  }
} finally {
  await model?.unload();
}

// ---- metrics ----
const byId = new Map(items.map((i) => [i.id, i]));
const pct = (num: number, den: number) => (den === 0 ? "n/a" : `${((100 * num) / den).toFixed(1)}%`);
const flagged = (p: Prediction) => p.level !== "safe";
const severe = (p: Prediction) => p.level === "high_risk" || p.level === "scam";
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]! : NaN);

function summary(mode: Mode, filter: (i: Item) => boolean = () => true) {
  const preds = predictions.filter((p) => p.mode === mode && filter(byId.get(p.id)!));
  const scams = preds.filter((p) => byId.get(p.id)!.label === "scam");
  const benign = preds.filter((p) => byId.get(p.id)!.label === "benign");
  const caught = scams.filter(flagged);
  return {
    n: preds.length,
    recall: pct(caught.length, scams.length),
    recallSevere: pct(scams.filter(severe).length, scams.length),
    fpr: pct(benign.filter(flagged).length, benign.length),
    fprSevere: pct(benign.filter(severe).length, benign.length),
    categoryAcc: pct(caught.filter((p) => p.category === byId.get(p.id)!.category).length, caught.length),
    jsonValid: mode === "rules" ? "-" : pct(preds.filter((p) => p.jsonValid).length, preds.length),
    p50ms: mode === "rules" ? "-" : quantile(preds.map((p) => p.ms!), 0.5).toFixed(0),
    p95ms: mode === "rules" ? "-" : quantile(preds.map((p) => p.ms!), 0.95).toFixed(0),
  };
}

const lines: string[] = [];
const table = (rows: Record<string, string | number>[]) => {
  const keys = Object.keys(rows[0]!);
  lines.push(`| ${keys.join(" | ")} |`, `|${keys.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${keys.map((k) => r[k]).join(" | ")} |`), "");
};

lines.push(`# Kinga eval: ${values.split} split, ${items.length} items`, "", `Generated ${new Date().toISOString()}. "flagged" = any level above safe; "severe" = high_risk or scam.`, "");
lines.push("## Overall", "");
table(modes.map((m) => ({ mode: m, ...summary(m) })));

lines.push("## By language (recall / false-positive rate)", "");
const langs = [...new Set(items.map((i) => i.lang))];
table(langs.map((lang) => ({ lang, ...Object.fromEntries(modes.map((m) => { const s = summary(m, (i) => i.lang === lang); return [m, `${s.recall} / ${s.fpr}`]; })) })));

lines.push("## By category (share flagged; for not_scam this is the false-positive rate)", "");
const categories = [...new Set(items.map((i) => i.category))];
table(categories.map((category) => ({
  category,
  n: items.filter((i) => i.category === category).length,
  ...Object.fromEntries(modes.map((m) => {
    const preds = predictions.filter((p) => p.mode === m && byId.get(p.id)!.category === category);
    return [m, pct(preds.filter(flagged).length, preds.length)];
  })),
})));

// Rule signals vs the labeller's expected signals. S5 (balance did not change) needs the real wallet, so it is skipped.
const missed = new Map<string, number>();
let expected = 0;
let found = 0;
for (const p of predictions.filter((p) => p.mode === (modes.includes("rules") ? "rules" : modes[0]))) {
  for (const code of byId.get(p.id)!.expected_signals.filter((c) => c !== "S5")) {
    expected++;
    // The labeller uses S1 for any brand claim from a personal number; the rules split that into S1 (receipts) and S12.
    if (p.signals.includes(code as SignalId) || (code === "S1" && p.signals.includes("S12"))) found++;
    else missed.set(code, (missed.get(code) ?? 0) + 1);
  }
}
const topMissed = [...missed].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(", ");
lines.push("## Rule signal recall", "", `${found}/${expected} expected signals found (${pct(found, expected)}). Most missed: ${topMissed || "none"}.`, "");

lines.push("## Errors", "");
for (const m of modes) {
  const wrong = predictions.filter((p) => p.mode === m && flagged(p) !== (byId.get(p.id)!.label === "scam"));
  lines.push(`### ${m}: ${wrong.length} wrong`, "");
  for (const p of wrong) {
    const i = byId.get(p.id)!;
    lines.push(`- \`${i.id}\` ${i.label}/${i.category} → **${p.level}** [${p.signals.join(",")}] (${i.lang}) ${i.text.slice(0, 110).replace(/\|/g, "/")}…`);
  }
  lines.push("");
}

mkdirSync("eval/reports", { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const base = `eval/reports/${stamp}-${values.split}`;
writeFileSync(`${base}.md`, lines.join("\n"));
writeFileSync(`${base}.json`, JSON.stringify(predictions, null, 1));
console.log(lines.slice(0, 12).join("\n"));
console.log(`\nreport: ${base}.md`);

// Ledger eval: random but self-consistent M-PESA histories with one template-perfect forgery inserted.
// The forgery uses the real "MPESA" sender ID (spoofing, the worst case) and a flawless template, so only the
// balance can give it away. Compares the text-only rules with the ledger, with and without missing messages.
// npm run eval:ledger [-- --trials 1000]
//
// Caveat: the histories come from this script's own templates, which the parser was written for. This tests
// the balance arithmetic and the decision logic, not parsing robustness on real-world SMS variants.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { analyze, MpesaLedger, type Message, type RiskLevel } from "@kinga/core";

const { values } = parseArgs({ options: { trials: { type: "string", default: "1000" }, seed: { type: "string", default: "20261029" } } });
const TRIALS = Number(values.trials);

// mulberry32: small seeded PRNG so the report is reproducible.
let state = Number(values.seed) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;

const NAMES = ["JOHN KAMAU", "MARY WANJIKU", "PETER OTIENO", "GRACE ACHIENG", "DAVID KIPROP", "FAITH MUTHONI", "BRIAN OUMA", "LUCY NJERI"];
const SHOPS = ["NAIVAS MOI AVENUE", "QUICKMART KILIMANI", "CARREFOUR TRM", "MAMA OLIECH HOTEL"];
const ksh = (n: number) => `Ksh${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const masked = () => `07${int(10, 99)}***${int(100, 999)}`;
const code = (when: Date) =>
  `U${String.fromCharCode(65 + when.getUTCMonth())}${Array.from({ length: 8 }, () => pick([..."ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"])).join("")}`;
const date = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`;
const time = (d: Date) => {
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const cost = (amount: number) => (amount <= 100 ? 0 : amount <= 1000 ? 13 : amount <= 5000 ? 33 : 57);

interface Step {
  message: Message;
  forged: boolean;
}

function received(when: Date, amount: number, balance: number): string {
  return random() < 0.15
    ? `${code(when)} Imethibitishwa. Umepokea ${ksh(amount)} kutoka kwa ${pick(NAMES)} ${masked()} tarehe ${date(when)} saa ${time(when)}. Salio jipya la M-PESA ni ${ksh(balance)}.`
    : `${code(when)} Confirmed.You have received ${ksh(amount)} from ${pick(NAMES)} ${masked()} on ${date(when)} at ${time(when)} New M-PESA balance is ${ksh(balance)}.`;
}

function history(): { steps: Step[]; balances: number[] } {
  let balance = int(500, 50_000);
  let when = new Date(Date.UTC(2026, 9, int(1, 20), int(6, 20), int(0, 59)));
  const steps: Step[] = [];
  const balances: number[] = [];
  for (let i = 0, n = int(8, 20); i < n; i++) {
    when = new Date(when.getTime() + int(10, 600) * 60_000);
    const kind = balance < 300 ? "received" : pick(["received", "received", "sent", "till", "paybill", "withdraw"] as const);
    let text: string;
    if (kind === "received") {
      const amount = int(1, 400) * 50;
      balance += amount;
      text = received(when, amount, balance);
    } else {
      const amount = int(1, Math.max(1, Math.floor((balance * 0.6) / 10))) * 10;
      const fee = kind === "till" ? 0 : cost(amount);
      balance -= amount + fee;
      text =
        kind === "sent"
          ? `${code(when)} Confirmed. ${ksh(amount)} sent to ${pick(NAMES)} ${masked()} on ${date(when)} at ${time(when)}. New M-PESA balance is ${ksh(balance)}. Transaction cost, ${ksh(fee)}.`
          : kind === "till"
            ? `${code(when)} Confirmed. ${ksh(amount)} paid to ${pick(SHOPS)}. on ${date(when)} at ${time(when)}.New M-PESA balance is ${ksh(balance)}. Transaction cost, ${ksh(fee)}.`
            : kind === "paybill"
              ? `${code(when)} Confirmed. ${ksh(amount)} sent to KPLC PREPAID for account ${int(10_000_000, 99_999_999)} on ${date(when)} at ${time(when)} New M-PESA balance is ${ksh(balance)}. Transaction cost, ${ksh(fee)}.`
              : `${code(when)} Confirmed.on ${date(when)} at ${time(when)}Withdraw ${ksh(amount)} from ${int(100_000, 999_999)} - ${pick(SHOPS)} New M-PESA balance is ${ksh(balance)}. Transaction cost, ${ksh(fee)}.`;
    }
    steps.push({ message: { channel: "sms", sender: "MPESA", text }, forged: false });
    balances.push(balance);
  }
  return { steps, balances };
}

type Attacker = "guesses balance" | "knows exact balance";
type Condition = { attacker: Attacker; missing: number; atEnd: boolean };

interface Tally {
  forgeries: number;
  textFlagged: number;
  ledgerScam: number;
  ledgerFlagged: number;
  contradicts: number;
  doesNotFit: number;
  unverifiable: number;
  genuine: number;
  genuineFlagged: number;
  genuineContradicts: number;
}

const flagged = (level: RiskLevel) => level !== "safe";
const examples: string[] = [];

function trial(condition: Condition, tally: Tally) {
  const { steps, balances } = history();
  // Insert the forgery between two messages, or after the last one (nothing after it yet).
  const at = condition.atEnd ? steps.length : int(1, steps.length - 1);
  const prev = steps[at - 1]!;
  const prevBalance = balances[at - 1]!;
  const amount = int(10, 1000) * 50;
  const fakeBalance = condition.attacker === "knows exact balance" ? prevBalance + amount : Math.max(amount, Math.round((prevBalance + amount) * (0.5 + random())) );
  // Use the date/time of the previous message plus a few minutes so ordering is right.
  const prevMatch = prev.message.text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2}) (?:at|saa) (\d{1,2}):(\d{2}) ([AP]M)/);
  const [, d, m, y, hh, mm, ap] = prevMatch!;
  const prevDate = new Date(Date.UTC(2000 + Number(y), Number(m) - 1, Number(d), (Number(hh) % 12) + (ap === "PM" ? 12 : 0), Number(mm)));
  const nextText = steps[at]?.message.text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2}) (?:at|saa) (\d{1,2}):(\d{2}) ([AP]M)/);
  const nextDate = nextText
    ? new Date(Date.UTC(2000 + Number(nextText[3]), Number(nextText[2]) - 1, Number(nextText[1]), (Number(nextText[4]) % 12) + (nextText[6] === "PM" ? 12 : 0), Number(nextText[5])))
    : new Date(prevDate.getTime() + 120 * 60_000);
  const fakeWhen = new Date(prevDate.getTime() + Math.max(1, Math.floor((nextDate.getTime() - prevDate.getTime()) / 120_000)) * 60_000);
  const fake: Step = {
    message: {
      channel: "sms",
      sender: "MPESA",
      text: `${code(fakeWhen)} Confirmed.You have received ${ksh(amount)} from ${pick(NAMES)} ${masked()} on ${date(fakeWhen)} at ${time(fakeWhen)} New M-PESA balance is ${ksh(fakeBalance)}.`,
    },
    forged: true,
  };
  const inbox = [...steps.slice(0, at), fake, ...steps.slice(at)].filter((s) => s.forged || random() >= condition.missing);
  const ledger = new MpesaLedger(inbox.map((s) => s.message));

  for (const step of inbox) {
    const text = analyze(step.message);
    const withLedger = analyze(step.message, { ledger });
    if (step.forged) {
      tally.forgeries++;
      if (flagged(text.level)) tally.textFlagged++;
      if (withLedger.level === "scam") tally.ledgerScam++;
      if (flagged(withLedger.level)) tally.ledgerFlagged++;
      const status = ledger.check(step.message).status;
      if (status === "contradicts") tally.contradicts++;
      if (status === "does_not_fit") tally.doesNotFit++;
      if (status === "unverifiable") tally.unverifiable++;
    } else {
      tally.genuine++;
      if (flagged(withLedger.level)) {
        tally.genuineFlagged++;
        if (examples.length < 5) examples.push(`${withLedger.level} [${withLedger.signals.map((s) => `${s.id}:${s.strength}`).join(", ")}] ${step.message.text.slice(0, 90)}`);
      }
      if (ledger.check(step.message).status === "contradicts") tally.genuineContradicts++;
    }
  }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const conditions: Condition[] = [
  { attacker: "guesses balance", missing: 0, atEnd: false },
  { attacker: "knows exact balance", missing: 0, atEnd: false },
  { attacker: "guesses balance", missing: 0.1, atEnd: false },
  { attacker: "knows exact balance", missing: 0.1, atEnd: false },
  { attacker: "guesses balance", missing: 0, atEnd: true },
];

const rows: string[] = [];
for (const condition of conditions) {
  const tally: Tally = { forgeries: 0, textFlagged: 0, ledgerScam: 0, ledgerFlagged: 0, contradicts: 0, doesNotFit: 0, unverifiable: 0, genuine: 0, genuineFlagged: 0, genuineContradicts: 0 };
  for (let i = 0; i < TRIALS; i++) trial(condition, tally);
  rows.push(
    `| ${condition.attacker} | ${condition.missing ? `${condition.missing * 100}% missing` : "complete"} | ${condition.atEnd ? "newest message" : "between messages"} | ${pct(tally.textFlagged, tally.forgeries)} | ${pct(tally.ledgerScam, tally.forgeries)} | ${pct(tally.ledgerFlagged, tally.forgeries)} | ${tally.contradicts}/${tally.doesNotFit}/${tally.unverifiable} | ${pct(tally.genuineFlagged, tally.genuine)} (${tally.genuineFlagged}/${tally.genuine}) | ${tally.genuineContradicts} |`,
  );
}

const report = [
  `# Kinga ledger eval: template-perfect forgeries`,
  "",
  `Generated ${new Date().toISOString()}, ${TRIALS} histories per row (8–20 genuine messages each, seed ${values.seed}).`,
  "Each history gets one forged \"You have received\" SMS with a flawless template and the real MPESA sender ID.",
  "",
  "| forger | history | where | caught by text rules | ledger: scam | ledger: any warning | contradicts / does not fit / unverifiable | genuine messages warned | genuine called contradicting |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  "- **caught by text rules**: the same forgery checked without the ledger (template, sender, wording only).",
  "- **ledger: scam**: the ledger proves the money never arrived (the messages around it add up without it).",
  "- **genuine messages warned**: real messages that got any warning with the ledger on. Missing messages make real ones not fit: an outgoing one stays safe, an incoming one becomes 'suspicious: check your balance before handing anything over'. None is ever called a scam.",
  "",
  ...(examples.length ? ["Genuine messages that got a warning (first five):", "", ...examples.map((e) => `- ${e}`), ""] : []),
  "Caveat: histories come from this script's templates, which the parser was written for. This tests the balance arithmetic and decision logic, not parsing of real-world SMS variants.",
].join("\n");

mkdirSync("eval/reports", { recursive: true });
const file = `eval/reports/ledger-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
writeFileSync(file, report);
console.log(report);
console.log(`\nreport: ${file}`);

// Renders the synthetic payment screenshots used by the demo and the screenshot eval, with headless Edge.
// Everything is local: the HTML is written to disk and rendered from file://. All names and codes are invented.
// npm run make:screenshots
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, "eval/data/screenshots");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

export interface Screenshot {
  file: string;
  layout: "sms" | "app";
  /** What a perfect reader should extract. */
  truth: { code: string; amount: number; counterparty: string; direction: "sent" | "received" };
  sms?: string;
  app?: { amount: string; to: string; id: string; date: string; fee: string };
}

export const SCREENSHOTS: Screenshot[] = [
  {
    file: "brian-sms.png",
    layout: "sms",
    truth: { code: "UJ7M2QK8TA", amount: 6500, counterparty: "AMINA HASSAN", direction: "sent" },
    sms: "UJ7M2QK8TA Confirmed. Ksh6,500.00 sent to AMINA HASSAN 0722***514 on 28/10/26 at 4:12 PM. New M-PESA balance is Ksh2,140.00. Transaction cost, Ksh33.00. Amount you can transact within the day is 493,500.00.",
  },
  {
    file: "kevin-sms.png",
    layout: "sms",
    truth: { code: "UJ7P9XK3LC", amount: 13000, counterparty: "AMINA HASSAN", direction: "sent" },
    sms: "UJ7P9XK3LC Confirmed. Ksh13,000.00 sent to AMINA HASSAN 0722***514 on 28/10/26 at 5:20 PM. New M-PESA balance is Ksh4,870.00. Transaction cost, Ksh57.00. Amount you can transact within the day is 487,000.00.",
  },
  {
    file: "faith-app.png",
    layout: "app",
    truth: { code: "UJ7N4RD2WB", amount: 9750, counterparty: "AMINA HASSAN", direction: "sent" },
    app: { amount: "Ksh 9,750.00", to: "AMINA HASSAN", id: "UJ7N4RD2WB", date: "28 Oct 2026, 5:03 PM", fee: "Ksh 57.00" },
  },
  {
    file: "forged-app.png",
    layout: "app",
    truth: { code: "UJ8A1BC2DE", amount: 20000, counterparty: "AMINA HASSAN", direction: "sent" },
    app: { amount: "Ksh 20,000.00", to: "AMINA HASSAN", id: "UJ8A1BC2DE", date: "28 Oct 2026, 6:45 PM", fee: "Ksh 57.00" },
  },
];

const FONT = `font-family: Arial, Helvetica, sans-serif;`;
const HEAD = `<meta name="viewport" content="width=400"><style>*{box-sizing:border-box}html,body{width:400px;overflow:hidden}</style>`;

function smsPage(text: string): string {
  return `<!doctype html><html><head>${HEAD}</head><body style="margin:0;background:#fff;${FONT}">
  <div style="background:#f1f3f4;padding:14px 16px;font-size:18px;font-weight:500;border-bottom:1px solid #ddd">&#8592;&nbsp;&nbsp;MPESA</div>
  <div style="padding:16px;color:#5f6368;font-size:12px;text-align:center">Today</div>
  <div style="margin:0 16px;background:#e8eaed;border-radius:18px;padding:12px 14px;font-size:15px;line-height:1.45;color:#202124;max-width:330px">${text}</div>
  <div style="margin:6px 20px;color:#5f6368;font-size:11px">SMS</div>
  </body></html>`;
}

function appPage(a: NonNullable<Screenshot["app"]>): string {
  const row = (k: string, v: string) =>
    `<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #eee;font-size:15px"><span style="color:#666">${k}</span><span style="font-weight:600;text-align:right">${v}</span></div>`;
  return `<!doctype html><html><head>${HEAD}</head><body style="margin:0;background:#fff;${FONT}">
  <div style="background:#2e7d32;color:#fff;padding:16px;font-size:18px;font-weight:600">M-PESA</div>
  <div style="text-align:center;padding:24px 16px 8px">
    <div style="width:56px;height:56px;border-radius:50%;background:#e8f5e9;color:#2e7d32;font-size:30px;line-height:56px;margin:0 auto">&#10003;</div>
    <div style="font-size:14px;color:#666;margin-top:12px">Transaction successful</div>
    <div style="font-size:28px;font-weight:700;margin-top:4px">${a.amount}</div>
  </div>
  <div style="padding:0 20px">${row("Sent to", a.to)}${row("Transaction ID", a.id)}${row("Date", a.date)}${row("Transaction fee", a.fee)}</div>
  </body></html>`;
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  mkdirSync(OUT, { recursive: true });
  for (const s of SCREENSHOTS) {
    const html = join(OUT, s.file.replace(/\.png$/, ".html"));
    writeFileSync(html, s.layout === "sms" ? smsPage(s.sms!) : appPage(s.app!));
    execFileSync(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=400,520", "--force-device-scale-factor=2.5", `--screenshot=${join(OUT, s.file)}`, pathToFileURL(html).href], {
      stdio: "ignore",
    });
    console.log("wrote", join(OUT, s.file));
  }
}

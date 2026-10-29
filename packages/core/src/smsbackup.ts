// Reads an SMS export from the Android app "SMS Backup & Restore" (XML), so the ledger can use the user's own
// M-PESA messages. Runs locally; the file never leaves the device.
// The sender is the raw address the phone recorded, never the contact name: a scammer's number saved in the
// victim's phone as "M-Pesa" must not count as MPESA.
import type { Message } from "./types.js";

export interface BackupSms extends Message {
  /** Milliseconds since epoch, from the phone. */
  receivedAt: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[match[1]!] = unescapeXml(match[2]!);
  return out;
}

/** Received SMS (type 1) from the export, oldest first. Sent messages and MMS are skipped. */
export function parseSmsBackup(xml: string): BackupSms[] {
  if (!/<smses[\s>]/.test(xml)) throw new Error("This does not look like an SMS Backup & Restore export (no <smses> element).");
  const messages: BackupSms[] = [];
  for (const match of xml.matchAll(/<sms\s[^>]*?\/?>/g)) {
    const a = attributes(match[0]);
    if (a.type !== "1" || !a.address || a.body === undefined) continue;
    const contact = a.contact_name && a.contact_name !== "(Unknown)" ? a.contact_name : null;
    messages.push({ channel: "sms", sender: a.address.trim(), contact, text: a.body, receivedAt: Number(a.date) || 0 });
  }
  return messages.sort((x, y) => x.receivedAt - y.receivedAt);
}

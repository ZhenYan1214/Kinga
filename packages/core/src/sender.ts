import type { Message, SenderKind } from "./types.js";

const PHONE = /^(?:\+?254|0)?[17]\d{8}$/;

export function senderKind(message: Pick<Message, "channel" | "sender">): SenderKind {
  if (message.channel === "p2p_chat") return "chat";
  const compact = message.sender.replace(/[\s-]/g, "");
  if (PHONE.test(compact) || /^\+?\d{9,15}$/.test(compact)) return "phone";
  if (/^\d{3,6}$/.test(compact)) return "shortcode";
  return /[a-z]/i.test(compact) ? "official_id" : "phone";
}

/** Genuine M-PESA confirmations only ever come from this sender ID. */
export function isMpesaSender(sender: string): boolean {
  return /^m-?pesa$/i.test(sender.trim());
}

/** An unknown personal number: the sender most scams come from. */
export function isUnknownPerson(message: Message): boolean {
  const kind = senderKind(message);
  return (kind === "phone" || kind === "chat") && !message.contact;
}

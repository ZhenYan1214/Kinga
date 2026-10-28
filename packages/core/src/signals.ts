// Keyword and pattern signals over the message text (research notes §4). English, Swahili and Sheng cues.
// Each rule returns the matched text as evidence so the explanation can quote it.
import { isMpesaSender, isUnknownPerson, senderKind } from "./sender.js";
import type { Message, Signal, SignalId, Strength } from "./types.js";

const OFFICIAL_DOMAINS = [
  "safaricom.co.ke",
  "safaricom.com",
  "mpesa.co.ke",
  "go.ke",
  "kplc.co.ke",
  "kcbgroup.com",
  "equitybank.co.ke",
  "equitygroupholdings.com",
  "binance.com",
  "airtelkenya.com",
];
const SHORTENERS = /\b(?:bit\.ly|tinyurl\.com|wa\.me|t\.me|forms\.gle|cutt\.ly|rb\.gy|is\.gd|shorturl\.at|tiny\.cc|goo\.gl)\b/i;
const URL =
  /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+(?:com|co\.ke|co|ke|top|xyz|info|net|org|link|site|online|app|me|ly|ru|cc|io|live|shop|club|gl|at|gd|vip|biz|pro|win|bet))\b(?:\/\S*)?/gi;
const BRANDS =
  /\b(?:safaricom|m-?pesa|fuliza|m-?shwari|kcb|equity|equitel|helb|kra|sha|nhif|hustler fund|e-?citizen|huduma|airtel|binance|kplc|dci|ntsa|bonga)\b/i;
const NEGATED_SHARING =
  /\b(?:do not|don't|dont|never|usi\w*|hatutawahi|we will never|will never)\b[^.]{0,40}\b(?:share|give|tell|send|disclose|ask|shiriki|mpe|tuma|uliza)/i;

const SECRET = String.raw`(?:pin|puk|otp|one[- ]time (?:password|code)|verification code|m-?pesa code|id number|namba ya (?:id|kitambulisho|siri)|password|seed phrase|recovery phrase|2fa(?: code)?|tarakimu (?:sita|nne)|\d-digit code|(?:the |ile |hiyo )?code (?:ikikuja|imeingia|tuliyokutumia|we (?:have )?(?:just )?sent|ya m-?pesa))`;
const ASK = String.raw`(?:send|share|confirm|uconfirm|give|provide|tell|reply with|enter|read|verify|forward|tuma|nipe|nitumie|tutumie|thibitisha|weka|uweke)`;
const FEE_WORDS = String.raw`(?:fees?|charges?|training|materials|delivery|registration|usajili|processing|kuprocess|bond|clearance|recovery|package|activation|insurance|bima|tax|gate pass|uniform|correction|membership|uanachama|lifetime access|login|slip|deposit)`;

interface Rule {
  id: SignalId;
  strength: Strength | ((m: Message) => Strength);
  pattern: RegExp;
  reason: (evidence: string) => string;
  /** Extra condition on the message; the rule fires only when it returns true. */
  when?: (m: Message) => boolean;
}

const fromUntrusted = (m: Message) => senderKind(m) !== "official_id" && senderKind(m) !== "shortcode";

const RULES: Rule[] = [
  {
    id: "S3",
    // The same words from a saved contact are usually a genuine mistake, so they only count weakly.
    strength: (m) => (m.contact ? "weak" : "strong"),
    pattern:
      /\b(?:nimekosea|kimakosa|nirudishie|nirudish\w*|urudishe|rudisha|naomba urudishe|send (?:it|the money|them|my money) back|sent (?:it |the money |you )?(?:\w+ ){0,3}by mistake|wrong(?:ly)? sent|sent to the wrong number|credited [^.\n]{0,40}in error|return the (?:funds|money)|kindly (?:reverse|refund|return)|please (?:reverse|refund|return) (?:it|the|my))\b/i,
    reason: (e) => `It asks you to send money back yourself ("${e}"). Real mistaken transfers are reversed by Safaricom through 456, never by you.`,
    when: (m) => !isMpesaSender(m.sender),
  },
  {
    id: "S11",
    strength: "hard",
    pattern: new RegExp(String.raw`\b(?:${ASK}\b[^.\n]{0,40}\b${SECRET}|${SECRET}\b[^.\n]{0,30}\b${ASK}|${SECRET}\b[^.\n]{0,25}\b(?:to (?:confirm|verify|activate|keep|unlock)|ili (?:kuthibitisha|kuendelea)))\b`, "i"),
    reason: (e) => `It asks for a secret ("${e}"). Safaricom, banks and exchanges never ask for your PIN, OTP or seed phrase.`,
    when: (m) => fromUntrusted(m) && !NEGATED_SHARING.test(m.text),
  },
  {
    id: "S14",
    strength: "strong",
    pattern: /(?:\b(?:dial|piga|bonyeza)\s*\*[\d*]+#|\*\d{2,4}\*[\d*]+#|\bforward (?:this|the|that) (?:sms|message|code)\b|\bnitumie (?:hiyo )?code\b|\bsend me the code\b)/i,
    reason: (e) => `It tells you to dial a code or forward a message ("${e}"), which can hand control of your line or account to someone else.`,
    when: fromUntrusted,
  },
  {
    id: "S10",
    strength: "strong",
    pattern: new RegExp(
      [
        String.raw`\b(?:activation|processing|registration|facilitation|application|insurance|clearance|unlock(?:ing)?|withdrawal|interview|training|medical|visa|transport|service|verification|commitment|joining|delivery|tax|correction) (?:fee|charge|cost)s?\b`,
        String.raw`\bada ya \w+`,
        String.raw`\b(?:pay|lipa|ulipe|kulipa|unalipa|send|tuma)\b[^.\n]{0,30}?\d[\d,]*(?:k\b|\s?bob\b)?[^.\n]{0,30}?\b${FEE_WORDS}\b`,
        String.raw`\b${FEE_WORDS}\b[^.\n]{0,20}?(?:ksh|kes)\.?\s?\d`,
        String.raw`\b(?:register|jisajili|join|jiunge)\w*\b[^.\n]{0,25}(?:ksh|kes)\.?\s?\d`,
        String.raw`\bpay (?:a |the )?(?:small |refundable )?(?:fee|deposit)\b`,
      ].join("|"),
      "i",
    ),
    reason: (e) => `It wants a payment up front ("${e}"). Genuine loans, prizes, jobs and refunds do not charge a fee first.`,
    when: fromUntrusted,
  },
  {
    id: "S25",
    strength: "medium",
    pattern: /\b(?:pay|lipa|send|tuma|deposit)\b[^.\n]{0,40}\b(?:to|kwa|kwenye|via)\s+(?:namba\s+|number\s+|inspector\s+\w+\s+)?(?:\+?254|0)[17]\d{8}\b/i,
    reason: (e) => `It asks you to pay a personal phone number ("${e}"); businesses and agencies use a registered paybill or till.`,
    when: (m) => fromUntrusted(m) && !m.contact,
  },
  {
    id: "S13",
    strength: "medium",
    pattern:
      /\b(?:suspend\w*|deactivat\w*|terminat\w*|block(?:ed)? within|will be blocked|banned|frozen|freez\w*|arrest\w*|penalt\w*|legal action|cells|itafungwa|kufungiwa|itafungiwa|imefungwa|imesimamishwa|itasitishwa|blacklist\w*|warrant|appeal|nitazituma|expose you|leak (?:them|your))\b/i,
    reason: (e) => `It threatens you ("${e}") to make you act before you think.`,
    when: fromUntrusted,
  },
  {
    id: "S4",
    strength: "weak",
    pattern:
      /\b(?:urgent\w*|haraka|immediately|right now|asap|fasta|mara moja|leo leo|within \d+ ?(?:hours?|minutes?|hrs|mins)|ndani ya (?:dakika|saa)|before (?:\d{1,2} ?(?:pm|am)|midnight|friday|monday|tomorrow)|kabla ya saa \w+|today only|leo tu|sasa hivi|hospital|hospitali|karo|school fees|emergency|dharura|accident|ajali|stuck|in a hurry|flight to catch)\b/i,
    reason: (e) => `It pushes urgency or emotion ("${e}").`,
    when: fromUntrusted,
  },
  {
    id: "S15",
    strength: "strong",
    pattern:
      /\b(?:tuma (?:kwa|kwenye) (?:hii|hiyo) (?:namba|number|no\.?)|tuma kwa namba hii|(?:send|pay|deposit) (?:it |the money |the rent )?(?:to|into|via) (?:this|his|her|my new|the new|our new) (?:number|no\.?|paybill|till|account)|new (?:paybill|till|account|number)\b|paybill mpya|till mpya|namba mpya|nimebadilisha (?:namba|line)|(?:paybill|till|namba|account) [^.\n]{0,15}imebadilika|badala ya ile ya zamani|(?:i have |i've )?changed (?:my )?(?:number|paybill|account|line)|usitume kwa|(?:don't|do not) (?:use|send to|pay to) the old)/i,
    reason: (e) => `It redirects your payment to a new number or account ("${e}"). Confirm by calling the person on the number you already know.`,
    when: (m) => !isMpesaSender(m.sender) && !m.contact,
  },
  {
    id: "S16",
    strength: "medium",
    pattern: /\b(?:mum|mom|mama|mathe|mwanangu|dad|baba|buda|son|daughter|bro|sis|cuz|auntie|aunty|uncle|cousin|babe|mpenzi|boss|landlord|mwenye nyumba|it's me|ni mimi)\b/i,
    reason: (e) => `It claims to be someone close ("${e}") but comes from a number that is not in your contacts.`,
    when: (m) =>
      isUnknownPerson(m) &&
      m.channel !== "p2p_chat" &&
      /\b(?:tuma|send|nitumie|nisort|pesa|money|doh|ganji|bob|ksh|mpesa|m-pesa|code|\d+k|\d{3,})\b/i.test(m.text),
  },
  {
    id: "S17",
    strength: "strong",
    pattern:
      /(?:\d+(?:\.\d+)?\s?%\s*(?:daily|per day|a day|weekly|per week|kila siku|kwa siku)|\bdoubl(?:e|ing)\b|\bguaranteed (?:profit|returns?|income|earnings)|\b(?:earn|unapata|get)\s+(?:ksh\.?\s?|kes\s?|\$)?[\d,]+(?:-[\d,]+)?\s*(?:usdt\s*)?(?:\/day|daily|per day|a day|kila siku)|\bfaida ya kila siku\b|\bzidisha mara\b|\bpassive income\b|\bno risk\b|\buhakika wa \d+%|\b\d{2,3}% (?:accuracy|sure|uhakika|win rate)|\bhit \d+ out of \d+)/i,
    reason: (e) => `It promises fixed or very high returns ("${e}"). No genuine investment or tip guarantees results like this.`,
    when: fromUntrusted,
  },
  {
    id: "S18",
    strength: "medium",
    pattern: /\b(?:refer(?:ral)?s?|invite \d+ (?:friends|people)|downline|recruit\w*|alika marafiki|bonus for every|ukileta watu|leta watu|share (?:the )?link (?:kwa|to|with) (?:marafiki|friends))\b/i,
    reason: (e) => `It pays you to bring in others ("${e}"), a typical pyramid or Ponzi pattern.`,
  },
  {
    id: "S20",
    strength: "medium",
    pattern:
      /(?:\bT[1-9A-HJ-NP-Za-km-z]{33}\b|\b0x[0-9a-fA-F]{40}\b|\b(?:\w*deposit\w*|send|invest\w*|weka|tuma|top up|fund)\b[^.\n]{0,30}\b(?:usdt|usdc|btc|bitcoin|crypto|trc-?20|erc-?20)|\b(?:usdt|crypto) staking\b)/i,
    reason: (e) => `It asks you to put crypto into an address or platform ("${e}"), which cannot be reversed.`,
    when: fromUntrusted,
  },
  {
    id: "S21",
    strength: "strong",
    pattern:
      /\b(?:release (?:the )?(?:usdt|coins?|crypto|funds?|order)? ?(?:now|fast|quickly|immediately|haraka|asap)|achilia (?:haraka|sasa)|usipo-?release|mark (?:this|it) (?:one )?(?:as )?released|(?:check|see|look at) (?:the |my )?screenshot|angalia picha|picha nimetuma|i(?:'m| am) in a hurry|nimeshalipa,? (?:achilia|release)|marked? (?:it )?as paid,? (?:release|achilia)|paid from my \w+(?:'s)? (?:line|number|phone)|the name will show|paid (?:you )?on the other order)\b/i,
    reason: (e) => `It pressures you to release crypto before the money is confirmed ("${e}"). Check your own MPESA SMS first.`,
    when: (m) => m.channel === "p2p_chat" || senderKind(m) === "phone",
  },
  {
    id: "S22",
    strength: "medium",
    pattern: /\b(?:you have won|you've won|has won|umeshinda|umejishindia|kushinda|washindi|winner|jackpot|congratulations[^.]{0,40}(?:won|selected|winner)|zawadi (?:ya|yako)|voucher ya ksh)\b/i,
    reason: (e) => `It says you won something you did not enter ("${e}").`,
    when: fromUntrusted,
  },
  {
    id: "S23",
    strength: "strong",
    pattern: /\b(?:sure (?:odds|bets?|games?|tips?)|fixed (?:matches|games?|odds)|100% (?:sure|win|guaranteed)|vip (?:tips|games|odds|slip)|predictor app|insider info)\b/i,
    reason: (e) => `It sells "guaranteed" betting results ("${e}"); nobody can fix match outcomes for you.`,
  },
  {
    id: "S24",
    strength: "medium",
    pattern: /\b(?:(?:limit|fuliza)[^.\n]{0,30}\b(?:upgraded|increased|boost\w*|raised)|increase your (?:fuliza |loan )?limit|ongeza (?:limit|kikomo)|nakuongezea limit)\b/i,
    reason: (e) => `It offers to raise your loan or Fuliza limit ("${e}"). Limits are set by the system and cannot be bought.`,
    when: fromUntrusted,
  },
];

function linkSignals(message: Message): Signal[] {
  for (const match of message.text.matchAll(URL)) {
    const host = match[1]!.toLowerCase();
    if (OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    const shortener = SHORTENERS.test(match[0]);
    // One link signal is enough for the verdict.
    return [
      {
        id: "S9",
        strength: shortener || fromUntrusted(message) ? "medium" : "weak",
        evidence: match[0],
        reason: shortener
          ? `It contains a shortened link (${match[0]}) that hides where it really goes.`
          : `It links to ${host}, which is not an official Safaricom, bank or government site.`,
      },
    ];
  }
  return [];
}

// An organisation-style header ("KRA:", "TV Kenya:", "[Binance Support]:") or a mass greeting from a personal number.
const ORG_HEADER = /^\s*\[?[A-Z][\w .'&-]{1,40}\]?:/;
const MASS_GREETING =
  /\b(?:dear (?:customer|m-?pesa (?:customer|user)|subscriber|valued|investor|parent|member|applicant)|customer care|customer service|we are from|tunatoka|this is (?:safaricom|m-?pesa|kcb|equity|helb|kra|binance)|ni \w+ kutoka safaricom|^(?:wateja|wazazi|wanachama) wa)\b/i;

function brandSignal(message: Message): Signal[] {
  if (!isUnknownPerson(message)) return [];
  if (message.channel === "p2p_chat") {
    const support = message.text.match(/\b(?:binance|bybit|okx|exchange|p2p) (?:support|admin|team|officer)\b|\bverification officer\b/i);
    return support
      ? [{ id: "S12", strength: "strong", evidence: support[0], reason: `It claims to be "${support[0]}" inside the trade chat; exchange support never messages you there.` }]
      : [];
  }
  const header = message.text.match(ORG_HEADER)?.[0];
  const brand = message.text.slice(0, 60).match(BRANDS)?.[0];
  if (!header && !brand && !MASS_GREETING.test(message.text)) return [];
  const who = header?.replace(/[:[\]]/g, "").trim() ?? brand ?? "a company";
  return [
    {
      id: "S12",
      strength: "strong",
      evidence: message.sender,
      reason: `It speaks for ${who} but comes from a personal number (${message.sender}); organisations use a registered sender name.`,
    },
  ];
}

function groupMove(message: Message): Signal[] {
  const match = message.text.match(/\b(?:whatsapp|telegram|t\.me|wa\.me|inbox me|dm me|text me on|add you to (?:the|our|a) group|kundi (?:letu )?la telegram)\b/i);
  if (!match) return [];
  if (message.channel === "whatsapp" && /^whatsapp$/i.test(match[0])) return [];
  return [
    {
      id: "S19",
      strength: message.channel === "p2p_chat" ? "strong" : "weak",
      evidence: match[0],
      reason:
        message.channel === "p2p_chat"
          ? `It moves the trade off the exchange ("${match[0]}"), where escrow and appeals no longer protect you.`
          : `It pulls you into another channel or group ("${match[0]}").`,
    },
  ];
}

export function textSignals(message: Message): Signal[] {
  const signals: Signal[] = [];
  for (const rule of RULES) {
    if (rule.when && !rule.when(message)) continue;
    const match = message.text.match(rule.pattern);
    if (!match) continue;
    const strength = typeof rule.strength === "function" ? rule.strength(message) : rule.strength;
    signals.push({ id: rule.id, strength, evidence: match[0].trim(), reason: rule.reason(match[0].trim()) });
  }
  return [...signals, ...linkSignals(message), ...brandSignal(message), ...groupMove(message)];
}

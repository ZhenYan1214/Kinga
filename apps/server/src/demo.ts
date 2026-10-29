// Demo data for the two acts. Written for the demo, not taken from the eval set; all names, numbers and codes are invented.
// The seller and landlady is AMINA HASSAN. Her MPESA messages form one consistent balance chain:
// 13,253 (27 Oct, after Grace's Ksh20) -> -1,523 = 11,730 -> +6,500 -> +9,750 -> -450 -> -1,013 = 26,517,
// with one spoofed "MPESA" forgery (m12) in between.
import type { Message } from "@kinga/core";

export interface InboxItem extends Message {
  id: string;
  time: string;
}

export const DEMO_INBOX: InboxItem[] = [
  {
    // The real rent "payment": Ksh20. Grace later shows Amina this message edited to Ksh20,000 (grace-rent.png).
    id: "m00",
    time: "27 Oct, 9:10 AM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ6R4TG8NP Confirmed.You have received Ksh20.00 from GRACE MUTHONI 0711***902 on 27/10/26 at 9:10 AM New M-PESA balance is Ksh13,253.00.",
  },
  {
    id: "m01",
    time: "28 Oct, 4:12 PM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ7M2QK8TA Confirmed.You have received Ksh6,500.00 from BRIAN OUMA 0712***408 on 28/10/26 at 4:12 PM New M-PESA balance is Ksh18,230.00. Separate personal and business funds through Pochi la Biashara on *334#.",
  },
  {
    id: "m02",
    time: "28 Oct, 5:03 PM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ7N4RD2WB Confirmed.You have received Ksh9,750.00 from PETER NJOROGE 0790***115 on 28/10/26 at 5:03 PM New M-PESA balance is Ksh27,980.00.",
  },
  {
    id: "m03",
    time: "28 Oct, 5:20 PM",
    channel: "sms",
    sender: "0745903112",
    text: "UJ7P9XK3LC Confirmed. You have received Ksh13,000.00 from KEVIN MUTUA 0745903112 on 28/10/26 at 5:20 PM New M-PESA balance is *LOCKED*.",
  },
  {
    id: "m04",
    time: "28 Oct, 5:31 PM",
    channel: "sms",
    sender: "0712300455",
    text: "Pole sana, nimetuma 2,000 kimakosa kwa namba yako. Tafadhali nirudishie kwa hii namba haraka, ni pesa ya hospitali.",
  },
  {
    id: "m05",
    time: "28 Oct, 6:02 PM",
    channel: "sms",
    sender: "0101223344",
    text: "Safaricom: Your line has been registered twice and will be suspended today. Reply with your M-PESA PIN to keep it active.",
  },
  {
    id: "m06",
    time: "28 Oct, 6:40 PM",
    channel: "sms",
    sender: "0733667120",
    text: "FULIZA: Hongera! Limit yako imeongezwa hadi Ksh30,000. Lipa Ksh250 ada ya activation kwa 0733667120 kabla ya saa kumi.",
  },
  {
    id: "m07",
    time: "28 Oct, 7:15 PM",
    channel: "sms",
    sender: "0722410733",
    contact: "Mum",
    text: "Nitumie 1,000 ya gas tafadhali, nitakurudishia Jumamosi.",
  },
  {
    id: "m08",
    time: "28 Oct, 8:00 PM",
    channel: "sms",
    sender: "Safaricom",
    text: "Enjoy 1.5GB for Ksh99 valid 24hrs. Dial *544# to buy. Terms apply.",
  },
  {
    id: "m09",
    time: "27 Oct, 7:40 PM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ7K1PL5RT Confirmed. Ksh1,500.00 sent to JANE WAMBUI 0723***901 on 27/10/26 at 7:40 PM. New M-PESA balance is Ksh11,730.00. Transaction cost, Ksh23.00. Amount you can transact within the day is 498,500.00.",
  },
  {
    id: "m13",
    time: "28 Oct, 6:10 PM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ7Q2TM4HX Confirmed. Ksh450.00 paid to NAIVAS MOI AVENUE. on 28/10/26 at 6:10 PM.New M-PESA balance is Ksh27,530.00. Transaction cost, Ksh0.00.",
  },
  {
    // Template-perfect, real sender ID, and the forger even knew the balance. Only the chain gives it away.
    id: "m12",
    time: "28 Oct, 6:45 PM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ8A1BC2DE Confirmed.You have received Ksh20,000.00 from DANIEL KIPRONO 0711***260 on 28/10/26 at 6:45 PM New M-PESA balance is Ksh47,530.00.",
  },
  {
    id: "m14",
    time: "28 Oct, 7:30 PM",
    channel: "sms",
    sender: "MPESA",
    text: "UJ7S5NB3KW Confirmed. Ksh1,000.00 sent to JANE WAMBUI 0723***901 on 28/10/26 at 7:30 PM. New M-PESA balance is Ksh26,517.00. Transaction cost, Ksh13.00. Amount you can transact within the day is 497,500.00.",
  },
  {
    id: "m10",
    time: "28 Oct, 9:05 PM",
    channel: "whatsapp",
    sender: "+254711093820",
    text: "Hi, I'm Linda from Global Crypto Club. Our AI bot pays 4% daily in USDT, guaranteed. Deposit from 50 USDT and invite friends for a bonus. Join t.me/gccbot",
  },
  {
    id: "m11",
    time: "28 Oct, 9:30 PM",
    channel: "sms",
    sender: "0798120334",
    text: "Hi Mum, my phone fell in water, this is my new number. Please send Ksh3,500 to this number for a new phone, I'll explain later.",
  },
];

export interface DemoOrder {
  id: string;
  buyerKycName: string;
  amountKsh: number;
  usdt: string;
  /** The code the buyer quoted; the demo reads it from the screenshot instead when the vision model is available. */
  claimedCode: string;
  /** The buyer's payment screenshot, in eval/data/screenshots. */
  screenshot: string;
  /** Account index on the test seed that plays the buyer, so demo USDT stays with us. */
  buyerAccount: number;
  /** Saved before the demo starts: repeat buyers are on the allowlist, a first-time buyer is not. */
  repeatBuyer: boolean;
  chat: string[];
  story: string;
}

export const DEMO_ORDERS: DemoOrder[] = [
  {
    id: "P2P-1001",
    buyerKycName: "Brian Otieno Ouma",
    amountKsh: 6500,
    usdt: "50",
    claimedCode: "UJ7M2QK8TA",
    screenshot: "brian-sms.png",
    buyerAccount: 1,
    repeatBuyer: true,
    chat: ["Hi, I've sent Ksh6,500 from my M-Pesa, name BRIAN OUMA. Please release when you see it, thanks."],
    story: "A repeat buyer who really paid.",
  },
  {
    id: "P2P-1002",
    buyerKycName: "Kevin Mutua",
    amountKsh: 13000,
    usdt: "100",
    claimedCode: "UJ7P9XK3LC",
    screenshot: "kevin-sms.png",
    buyerAccount: 2,
    repeatBuyer: false,
    chat: ["Paid! Check the screenshot I sent. Release the USDT now please, I'm in a hurry.", "We can continue on WhatsApp, it's faster."],
    story: "A new buyer whose 'receipt' came from a phone number.",
  },
  {
    id: "P2P-1003",
    buyerKycName: "Faith Akinyi",
    amountKsh: 9750,
    usdt: "75",
    claimedCode: "UJ7N4RD2WB",
    screenshot: "faith-app.png",
    buyerAccount: 3,
    repeatBuyer: true,
    chat: ["Done, paid 9,750. It came from my brother's line, the name will show PETER NJOROGE. Release fast please."],
    story: "Real money, but from someone else: triangular fraud.",
  },
  {
    id: "P2P-1004",
    buyerKycName: "Daniel Kiprono",
    amountKsh: 20000,
    usdt: "150",
    claimedCode: "UJ8A1BC2DE",
    screenshot: "forged-app.png",
    buyerAccount: 4,
    repeatBuyer: true,
    chat: ["Sent 20,000 from my M-Pesa, the SMS should already be on your phone. Kindly release."],
    story: "A perfect-looking 'MPESA' SMS is in your inbox, but your balances say the money never came.",
  },
];

/** Payment proofs someone shows Amina, for the "Did they really pay?" page. */
export interface DemoClaim {
  id: string;
  who: string;
  expectsKsh: number;
  payerName: string;
  screenshot: string;
  story: string;
}

export const DEMO_CLAIMS: DemoClaim[] = [
  {
    id: "rent-grace",
    who: "Grace, tenant: October rent",
    expectsKsh: 20000,
    payerName: "Grace Muthoni",
    screenshot: "grace-rent.png",
    story: "A real transaction, edited: she sent Ksh20 and changed the amount. Kenyan courts saw this exact trick twice in 2025.",
  },
  ...DEMO_ORDERS.map((o) => ({
    id: o.id,
    who: `${o.buyerKycName}: buys ${o.usdt} USDT`,
    expectsKsh: o.amountKsh,
    payerName: o.buyerKycName,
    screenshot: o.screenshot,
    story: o.story,
  })),
];

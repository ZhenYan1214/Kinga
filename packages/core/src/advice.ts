// What to do next, per category. Official channels from the research notes (§1): 333 to report a scam SMS,
// 456 for reversals (started by the sender), 334 to verify a masked sender, 0722 000 000 is Safaricom's only caller.
import type { Category, RiskLevel, Signal, SignalId } from "./types.js";

const REPORT = "Forward the message to 333 (free) so Safaricom can block the number.";

const ADVICE: Record<Category, string[]> = {
  not_scam: [],
  wrong_send_reversal: [
    "Do not send anything back. If the money really arrived, the sender must ask Safaricom to reverse it through 456.",
    "Check your real balance in the M-PESA app or with *334#.",
    REPORT,
  ],
  fake_mpesa_confirmation: [
    "Check your real balance in the M-PESA app or with *334# before handing over goods or crypto.",
    "Only an SMS from MPESA in your own inbox counts; screenshots and forwarded texts do not.",
    REPORT,
  ],
  fake_loan_or_fuliza: ["Fuliza and loan limits are set by the system and cannot be bought. Do not pay any fee.", REPORT],
  fake_customer_care: [
    "Never share your PIN, PUK or codes. Safaricom calls only from 0722 000 000 and never asks for your PIN.",
    "If you are worried about your line, dial 100 from your phone.",
    REPORT,
  ],
  fake_prize: ["You cannot win a promotion you did not enter. Do not pay a fee or open the link.", REPORT],
  relative_impersonation: [
    "Call the person on the number already saved in your phone before sending anything.",
    "Do not pay to a new number or paybill until they confirm it by voice.",
  ],
  sim_swap: [
    "Do not share any code you receive. If your phone suddenly shows No Service, call 100 from another phone.",
    REPORT,
  ],
  investment_or_crypto: ["Guaranteed returns are always a scam. Do not deposit money or USDT.", "Check whether the firm is licensed by the CMA."],
  job_scam: ["Real employers do not charge fees to apply or train. Check agencies on the NEA licensed list.", REPORT],
  betting_tips: ["Nobody can sell fixed matches. Do not pay for tips.", REPORT],
  government_impersonation: ["Government agencies are paid only through eCitizen or their official paybill, never a personal number.", REPORT],
  lookalike_paybill: ["Check the paybill or till against the business's official website or receipt before paying.", REPORT],
  romance_or_extortion: ["Do not pay. Keep the messages as evidence and report to the DCI hotline 0800 722 203."],
  p2p_payment_fraud: [
    "Do not release until an SMS from MPESA for the exact amount, from the buyer's own name, is in your inbox.",
    "Keep the trade and all chat on the exchange; open an appeal there if the buyer pushes.",
  ],
};

// Kiswahili, written during development; still to be reviewed by a native speaker.
const RIPOTI = "Tuma ujumbe huu kwa 333 (bure) ili Safaricom izuie namba hiyo.";

const ADVICE_SW: Record<Category, string[]> = {
  not_scam: [],
  wrong_send_reversal: [
    "Usirudishe pesa yoyote. Kama pesa kweli iliingia, aliyetuma lazima aombe Safaricom airudishe kupitia 456.",
    "Angalia salio lako halisi kwenye programu ya M-PESA au kwa *334#.",
    RIPOTI,
  ],
  fake_mpesa_confirmation: [
    "Angalia salio lako halisi kwenye programu ya M-PESA au kwa *334# kabla ya kutoa bidhaa au crypto.",
    "Ujumbe kutoka MPESA kwenye simu yako mwenyewe ndio ushahidi pekee; picha za skrini na jumbe zilizotumwa tena si ushahidi.",
    RIPOTI,
  ],
  fake_loan_or_fuliza: ["Kikomo cha Fuliza na mikopo huwekwa na mfumo na hakinunuliwi. Usilipe ada yoyote.", RIPOTI],
  fake_customer_care: [
    "Usimpe mtu yeyote PIN, PUK au code zako. Safaricom hupiga simu kutoka 0722 000 000 pekee na kamwe haiombi PIN yako.",
    "Kama una wasiwasi kuhusu laini yako, piga 100 kutoka kwa simu yako.",
    RIPOTI,
  ],
  fake_prize: ["Huwezi kushinda promosheni ambayo hukushiriki. Usilipe ada wala kufungua kiungo.", RIPOTI],
  relative_impersonation: [
    "Mpigie mtu huyo kwenye namba ambayo tayari umeihifadhi kwenye simu yako kabla ya kutuma chochote.",
    "Usilipe kwa namba mpya au paybill mpya hadi athibitishe kwa sauti.",
  ],
  sim_swap: ["Usimpe mtu code yoyote unayopokea. Simu yako ikionyesha ghafla 'No Service', piga 100 kutoka kwa simu nyingine.", RIPOTI],
  investment_or_crypto: ["Faida iliyohakikishwa daima ni utapeli. Usiweke pesa wala USDT.", "Hakikisha kama kampuni imesajiliwa na CMA."],
  job_scam: ["Waajiri halisi hawatozi ada ya kuomba kazi au mafunzo. Hakikisha wakala yuko kwenye orodha ya NEA.", RIPOTI],
  betting_tips: ["Hakuna anayeweza kuuza mechi zilizopangwa. Usilipe kwa tips.", RIPOTI],
  government_impersonation: ["Malipo ya serikali hufanywa kupitia eCitizen au paybill rasmi pekee, kamwe si namba ya mtu binafsi.", RIPOTI],
  lookalike_paybill: ["Linganisha paybill au till na tovuti rasmi ya biashara au risiti yao kabla ya kulipa.", RIPOTI],
  romance_or_extortion: ["Usilipe. Hifadhi jumbe hizi kama ushahidi na uripoti kwa DCI kupitia 0800 722 203."],
  p2p_payment_fraud: [
    "Usiachilie crypto hadi ujumbe kutoka MPESA wa kiasi kamili, kwa jina la mnunuzi mwenyewe, uingie kwenye simu yako.",
    "Weka biashara na mazungumzo yote ndani ya exchange; fungua appeal huko kama mnunuzi anakushinikiza.",
  ],
};

export type Language = "en" | "sw";

// Kiswahili versions of each rule's reason. Fixed text rather than model output: Qwen3 4B's own Swahili
// was not usable (repetitive, meaningless sentences), so only reviewed wording is shown in Swahili.
const REASON_SW: Record<SignalId, (e: string) => string> = {
  S1: (e) => `Ujumbe halisi wa M-PESA hutoka kwa MPESA pekee kwenye simu yako; huu haukutoka huko (${e}).`,
  S2: (e) => `Salio linasomeka "${e}" badala ya kiasi; salio la "LOCKED" ni ishara inayojulikana ya ujumbe feki.`,
  S3: (e) => `Unaombwa urudishe pesa mwenyewe ("${e}"). Pesa iliyotumwa kimakosa hurudishwa na Safaricom kupitia 456, si na wewe.`,
  S4: (e) => `Inakulazimisha uharakishe au inagusa hisia ("${e}").`,
  S5: () => `Kwa mujibu wa jumbe zako za M-PESA, pesa hii haikuwahi kuingia kwenye akaunti yako. Angalia salio kwa *334# ili uhakikishe.`,
  S6: (e) => `Code ya muamala ("${e}") haifanani na code za M-PESA (herufi kubwa na tarakimu, jumla 10).`,
  S7: (e) => `Muundo wa ujumbe ("${e}") haufanani na jinsi M-PESA huandika.`,
  S8: (e) => `Tangu Machi 2026 M-PESA huficha sehemu ya namba ya mtumaji, lakini huu unaonyesha namba kamili (${e}).`,
  S9: (e) => `Una kiungo (${e}) kisicho cha Safaricom, benki au serikali.`,
  S10: (e) => `Unaombwa ulipe kwanza ("${e}"). Mikopo, zawadi, kazi na marejesho halisi hayatozi ada mapema.`,
  S11: (e) => `Unaombwa siri yako ("${e}"). Safaricom, benki na exchange hawaombi kamwe PIN, OTP au seed phrase.`,
  S12: (e) => `Unajifanya kuwa shirika lakini unatoka kwa namba ya mtu binafsi (${e}); mashirika hutumia jina la mtumaji lililosajiliwa.`,
  S13: (e) => `Unakutishia ("${e}") ili ufanye haraka bila kufikiri.`,
  S14: (e) => `Unakuambia upige code au utume ujumbe ("${e}"); hii inaweza kumpa mtu mwingine udhibiti wa laini yako.`,
  S15: (e) => `Unabadilisha mahali pa kulipa kwenda namba au akaunti mpya ("${e}"). Thibitisha kwa kumpigia mtu huyo kwenye namba unayoijua.`,
  S16: (e) => `Unadai kuwa ni mtu wako wa karibu ("${e}") lakini unatoka kwa namba isiyo kwenye contacts zako.`,
  S17: (e) => `Unaahidi faida ya uhakika au kubwa sana ("${e}"). Hakuna uwekezaji halali unaohakikisha faida kama hii.`,
  S18: (e) => `Unakulipa ukileta watu wengine ("${e}"), mtindo wa kawaida wa piramidi au Ponzi.`,
  S19: (e) => `Unakuvuta kwenda channel au kundi lingine ("${e}").`,
  S20: (e) => `Unakuomba utume crypto kwa anwani au platform ("${e}"); haiwezi kurudishwa.`,
  S21: (e) => `Unakushinikiza uachilie crypto kabla pesa haijathibitishwa ("${e}"). Angalia kwanza ujumbe wa MPESA kwenye simu yako.`,
  S22: (e) => `Unasema umeshinda kitu ambacho hukushiriki ("${e}").`,
  S23: (e) => `Unauza matokeo ya mechi "yaliyohakikishwa" ("${e}"); hakuna anayeweza kupanga matokeo kwa ajili yako.`,
  S24: (e) => `Unaahidi kuongeza kikomo cha mkopo au Fuliza ("${e}"). Vikomo huwekwa na mfumo na havinunuliwi.`,
  S25: (e) => `Unakuomba ulipe kwa namba ya simu ya mtu ("${e}"); biashara na mashirika hutumia paybill au till iliyosajiliwa.`,
};

export function reasonInSwahili(signal: Signal): string {
  return REASON_SW[signal.id](signal.evidence);
}

export function adviceFor(category: Category, level: RiskLevel, language: Language = "en"): string[] {
  if (level === "safe") return [];
  return (language === "sw" ? ADVICE_SW : ADVICE)[category];
}

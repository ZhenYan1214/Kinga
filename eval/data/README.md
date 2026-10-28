# kenya-v1 evaluation set

`kenya-v1.jsonl` is a hand-built, held-out evaluation set for Kinga: 210 SMS, WhatsApp and P2P-chat messages of the kind a Kenyan M-Pesa / USDT user receives, labelled scam or benign.

**Every message is synthetic.** The set was written with AI assistance during development, from a taxonomy of Kenyan scam patterns and the genuine M-PESA SMS formats. Names, phone numbers, transaction codes, paybill/till numbers, links, domains and crypto addresses are invented. No real message was copied. Brand and agency names (Safaricom, KCB, HELB, KRA, Binance, ...) appear only because scammers impersonate them.

## Do not tune on the test split

Items with `"split": "test"` (90 items) are held out. Do not use them, or look at them, when writing or tuning prompts, rules, keyword lists or thresholds. Use `"split": "dev"` (120 items) for that, and report final numbers on `test`.

## Fields (one JSON object per line)

| Field | Meaning |
|---|---|
| `id` | `kv1-0001` ... `kv1-0210`, sequential. Order is shuffled, so ids carry no class information. |
| `split` | `dev` or `test` (about 60/40 within every category). |
| `channel` | `sms`, `whatsapp`, or `p2p_chat` (a message from the buyer inside an exchange P2P order chat). |
| `sender` | What the phone shows: an alphanumeric sender ID (`MPESA`, `Safaricom`, `KCB`, `Binance`, ...), a personal number (`07...`, `01...`, `+2547...`; one benign item uses a Nairobi `020` landline), or `P2P buyer`. |
| `contact` | The saved phonebook name if the sender is a saved contact (e.g. `Mum`, `Landlord Kamau`), else `null`. |
| `text` | The message body. `\n` marks a pasted second message. |
| `label` | `scam` or `benign`. |
| `category` | For scams one of the 14 classes below; for benign always `not_scam`. |
| `lang` | `en`, `sw` (Swahili), `sheng`, or `mixed` (English-Swahili code-switching). |
| `expected_signals` | Signal codes present in the message (S1-S20 from the research notes, plus S21). Empty for clean benign items; benign items that legitimately carry a scam-like marker list it (e.g. S9 for a safaricom.co.ke link, S13 for a genuine disconnection warning, S3 for a real wrong-send from a saved contact). |
| `note` | A few words on what makes the item tricky. |

### Signal codes

S1 claims M-PESA/bank/Safaricom from a personal number · S2 `LOCKED` / non-numeric balance · S3 asks you to send money back yourself (not via 456) · S4 urgency / emotion / deadline · S5 balance did not change (not observable from text, never listed) · S6 bad transaction-code format · S7 template deviation (currency, date, missing transaction cost, appended text) · S8 unmasked full number in a post-24-Mar-2026 received/P2P receipt · S9 link · S10 upfront fee · S11 asks for PIN / OTP / PUK / ID / M-PESA code / personal data · S12 brand or agency name from an unofficial sender · S13 threat (suspension, penalty, arrest, exposure) · S14 asks you to dial a code or forward/read out an SMS code · S15 redirects payment to a new number / paybill / account · S16 claims a relationship from an unknown number · S17 guaranteed or high fixed returns (incl. "sure" odds) · S18 referral / recruitment reward · S19 move to Telegram / WhatsApp · S20 pay or deposit USDT/crypto to an address or platform · **S21** P2P release pressure ("I've paid, release now", "check the screenshot").

Dial codes in genuine promos (`*544#`, `*334#`) are not counted as S14.

## Counts

| Class | Notes-section | dev | test | total |
|---|---|---|---|---|
| wrong_send_reversal | A | 5 | 4 | 9 |
| fake_mpesa_confirmation | B | 5 | 4 | 9 |
| fake_loan_or_fuliza | C | 5 | 4 | 9 |
| fake_customer_care | D | 5 | 4 | 9 |
| fake_prize | E | 5 | 4 | 9 |
| relative_impersonation | F | 5 | 4 | 9 |
| sim_swap | G | 5 | 4 | 9 |
| investment_or_crypto | H | 5 | 4 | 9 |
| job_scam | I | 5 | 4 | 9 |
| betting_tips | J | 5 | 4 | 9 |
| government_impersonation | K | 5 | 4 | 9 |
| lookalike_paybill | L | 5 | 4 | 9 |
| romance_or_extortion | M | 5 | 4 | 9 |
| p2p_payment_fraud | P2P | 5 | 4 | 9 |
| **scam total** | | 70 | 56 | **126** |
| not_scam (benign) | | 50 | 34 | **84** |
| **all** | | 120 | 90 | **210** |

Benign items are deliberately hard: 29 genuine M-PESA messages from `MPESA` (sent, received, paybill, buy goods, withdraw, Fuliza, reversal; mostly post-Mar-2026 masked format, 3 older unmasked), Safaricom notices and promos, bank OTPs and credit alerts, M-Shwari / KCB M-PESA, KPLC, other billers, Binance P2P system notifications, official HELB / KRA / eCitizen / SHA messages, money requests from saved family contacts, everyday chats, and polite P2P buyers. The split was assigned within each benign sub-group as well.

Languages: en 131, sw 39, mixed 23, sheng 17 (79 non-English, 38%). Scams: en 65, sw 30, mixed 18, sheng 13. Benign: en 66, sw 9, mixed 5, sheng 4.

Channels: sms 159, whatsapp 38, p2p_chat 13.

# Kinga

**Before you hand anything over: did they really pay?**

Kinga (Swahili for *protect*) checks M-Pesa payment claims on your own device, against your own M-PESA messages. An on-device vision model reads the payment screenshot a buyer sends you; your M-PESA balance history decides whether that money ever arrived. For people who sell USDT for M-Pesa, Kinga then gates the USDT release with a WDK wallet policy and signs it offline.

Built for **AI Yako: Own Your AI** (Tether QVAC, Node NBO Nairobi), track **On-device agentic finance**.

- Demo video (recorded with Wi-Fi off): _link to be added_
- Everything here was written during the hackathon, 27 to 30 October 2026. See [What existed before](#what-existed-before).

---

## The problem

- 49% of Kenyan mobile users received at least one scam call or SMS in a year, and about 10% of mobile-money users have lost money to fraud ([World Bank survey via Eastleigh Voice, Aug 2025](https://eastleighvoice.co.ke/mobile%20phones-smartphones/198632/nearly-half-of-kenyan-mobile-users-targeted-by-scams---world-bank); FinAccess 2024).
- The two scams Safaricom ranks highest in 2026 are both **fake money arriving**: the forged "you have received" confirmation, and "I sent it to you by mistake, please send it back" ([K24, Jul 2026](https://k24.digital/lifestyle/money/safaricom-lists-fake-fuliza-limit-messages-among-top-scams-targeting-m-pesa-users)).
- On P2P crypto markets the most common fraud is a **fake M-PESA payment proof** (a forged SMS or an edited screenshot) pushed at the seller with "release now, I'm in a hurry" ([Streamlinefeed, Aug 2026](https://streamlinefeed.co.ke/news/binance-p2p-kenya-survival-guide-avoid-mpesa-scams)).
- People are bad at spotting these, and generic tips do not help: in a Kenyan study, respondents classified 8.6 of 12 messages correctly, and awareness tips only made them flag more *genuine* messages ([IPA, 2022](https://poverty-action.org/blog/can-you-spot-scam-putting-fraud-attempts-test-kenya)).

All three scams claim that money came in when it did not. The seller's phone already holds the evidence to settle that question: the M-PESA messages it received. Kinga checks against them.

## How it works: the AI reads, the ledger decides

```
 buyer's screenshot ──► Qwen3-VL 2B (on device) ──► code, amount, name
                                                          │
 your M-PESA SMS ─────► ledger: balance chain ◄───────────┘
                                │
                                ▼
          paid / never arrived / paid by someone else / already used
                                │
              (USDT sellers) ───┴──► WDK policy ──► offline signature ──► broadcast (network step)
```

**The balance chain.** Every genuine M-PESA confirmation states your new balance, so consecutive messages must link: *previous balance + money in − (money out + fee) = new balance*. A forger cannot know your real balance. And even a forger who does know it is caught, because your next genuine message still follows from the old balance: the messages before and after the forgery add up without it. That proves the money never arrived, and the check works however perfect the forgery's template is.

**The models' role.** They only read and explain, and never decide that money is real:
- **Qwen3-VL 2B** turns a payment screenshot (SMS or M-PESA app) into a transaction code, amount, name and direction. Rules cannot read pictures.
- **Qwen3 4B** reads messages and P2P chats to spot pressure and impersonation, and explains each verdict in plain English. It can raise a warning, but it can never lower what the rules found, approve a release, or call a verified receipt fake.

## What you can do in the app

1. **Did they really pay?** Pick or upload a payment screenshot. Kinga shows what the model read and what your ledger says: *Yes, Ksh6,500 from BRIAN OUMA is in your M-PESA*, or *No, transaction UJ8A1BC2DE never reached your M-PESA*, with the reason.
2. **Your M-PESA ledger.** Your MPESA messages as a balance chain. Each one is marked as fitting or not, and a forgery is shown as *never happened*.
3. **Release USDT** (for USDT sellers). There are four checks, and every one must pass before the release is signed **offline**:
   1. The receipt is in your inbox, from MPESA, and fits the chain, and the payer's name matches the buyer's KYC name (this catches triangular fraud).
   2. The buyer's chat, read by the model. A warning must be acknowledged before you can continue.
   3. The destination is a saved address; look-alikes from address poisoning are blocked.
   4. The WDK policy: USDT only, a saved recipient, at most 200 USDT per release and 500 USDT per 24 hours.

   Broadcasting the signed release is a separate, labelled network step.
4. **Inbox guard.** Every message gets a verdict card. The words that triggered each rule are highlighted, the card says what to do (forward to 333, reversals go through 456, check your balance with *334#), and it has a Kiswahili mode.

The demo data is synthetic. The seller is Amina Hassan, and there are four buyer orders:

| Order | Buyer | What happens |
|---|---|---|
| 1001 | Brian | Paid. All checks pass and the release is signed offline. |
| 1002 | Kevin | His "receipt" code only exists in an SMS from a phone number. Forged. |
| 1003 | Faith | The money arrived, but from PETER NJOROGE. Triangular fraud. |
| 1004 | Daniel | A template-perfect SMS from "MPESA" sits in the inbox. Only the balance chain shows it never happened. |

## Results

**Template-perfect forgeries** (`npm run eval:ledger`). Each row is 1,000 random but self-consistent M-PESA histories, each with one forged "you have received" SMS. The forgery has a flawless template and the real `MPESA` sender ID.

| forger | history | caught by text rules | proved fake by the ledger | any warning with the ledger | genuine messages warned |
|---|---|---|---|---|---|
| guesses the balance | complete | 0.0% | **100.0%** | 100.0% | 0.0% |
| knows the exact balance | complete | 0.0% | **100.0%** | 100.0% | 0.0% |
| guesses the balance | 10% of SMS missing | 0.0% | 81.4% | 98.9% | 2.7% |
| knows the exact balance | 10% of SMS missing | 0.0% | 82.1% | 91.4% | 3.0% |
| guesses the balance | forgery is the newest message | 0.0% | 0.0% | 100.0% | 0.0% |

- When messages are missing, some genuine incoming payments no longer fit the chain. They get *"suspicious: check your balance before handing anything over"*; no genuine message was ever called a scam.
- A forgery that is the newest message cannot be proved fake until the next genuine message arrives, so it gets the same "check your balance" warning.
- Full report: [`eval/reports/ledger-2026-10-28-14-35.md`](eval/reports/ledger-2026-10-28-14-35.md).

**Screenshot reading** (`npm run spike:vision`). Qwen3-VL 2B read the transaction code, amount, name and direction correctly on all 4 demo screenshots (two layouts), in about 1 to 3 s each. At 400 px width it misread an amount (6,500 as 5,000); at phone resolution (1,000 px) every field was correct. This is why Kinga looks payments up by **code**, and the amount that counts is the one in your M-PESA.

**Message verdicts** (`npm run eval`). These use 210 synthetic Kenyan messages: 126 scams in 14 classes and 84 deliberately hard genuine ones, 38% of them in Swahili, Sheng or mixed language. A separate agent wrote them from the research notes without seeing the rule code. Rules were tuned on the dev split only, and the test split was run with settings frozen. Both models decode greedily (`temp 0`), so these numbers are reproducible.

| mode | dev: scam recall | dev: false positives | **test: scam recall** | **test: false positives** | test: category correct | time per message |
|---|---|---|---|---|---|---|
| rules only | 97.1% | 0.0% | 75.0% | 2.9% | 76.2% | < 1 ms |
| model only (Qwen3 4B) | 91.4% | 12.0% | 89.3% | 8.8% | 58.0% | 1.2 s |
| **rules + model** | 98.6% | 2.0% | **98.2%** | **8.8%** | 69.1% | 1.3 s |

- Rules alone drop from dev to test because they were tuned on dev. Adding the model lifts test recall from 75% to 98%, which is the model's measurable contribution. The cost is more false positives (2.9% to 8.8%).
- On the test split, three genuine messages were flagged:
  - a Fuliza notice written as `Ksh 120.00`, with a space
  - a polite P2P buyer saying "check your M-Pesa and release when it arrives"
  - a class WhatsApp-group link

  One Swahili betting scam was missed. Reports: [dev](eval/reports/2026-10-28-14-58-dev.md), [test](eval/reports/2026-10-28-15-02-test.md).
- The test split is small (34 genuine messages), so one message moves the false-positive rate by about 3 points.
- These are single messages with no ledger. The ledger checks above apply on top of them.

**Offline proof** (`npm run offline-proof`). The script starts Kinga and runs every demo message and order, including screenshot reading and an offline signature. Meanwhile it samples the TCP connections of every process Kinga starts (Node and QVAC's Bare worker) every 300 ms.
- Result: **0 outbound connections**, with the network switched on ([report](eval/reports/offline-proof-2026-10-28-14-50.md)).
- A `--control` run deliberately uses a network step, and the monitor catches it ([report](eval/reports/offline-proof-control-2026-10-28-13-56.md)), so a result of zero is meaningful.
- For the recording, `npm run offline-proof -- --wait-offline` starts once Wi-Fi goes off.

## QVAC integration

- **SDK:** `@qvac/sdk` **0.22.0**, pinned exactly. Models load from a local cache (`.models/`, set in `qvac.config.js`) and run fully offline after one download.

| Use | Model constant | Size | Config |
|---|---|---|---|
| Read messages and chats, explain verdicts | `QWEN3_4B_INST_Q4_K_M` (Qwen3-4B, Q4_K_M) | 2.50 GB | `ctx_size: 4096`; JSON-schema output with the reasoning fields before the category; `generationParams: { temp: 0, seed: 7 }`; `/no_think` |
| Read payment screenshots | `QWEN3VL_2B_MULTIMODAL_Q4_K` + `MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K` (Qwen3-VL-2B-Instruct) | 1.11 GB + 0.45 GB | `ctx_size: 4096`, `projectionModelSrc`; image attachment; JSON-schema output; `temp: 0` |

- **Files that use QVAC:**
  - [`packages/ai/src/index.ts`](packages/ai/src/index.ts): the message model and its prompt
  - [`packages/ai/src/vision.ts`](packages/ai/src/vision.ts): the screenshot reader
  - [`packages/ai/src/env.ts`](packages/ai/src/env.ts) and [`qvac.config.js`](qvac.config.js): the cache location
  - [`apps/server/src/main.ts`](apps/server/src/main.ts): loads both models
  - [`spikes/`](spikes): the model downloads and first experiments
  - [`eval/run.ts`](eval/run.ts): the message eval
- **Licences:**
  - Qwen3-4B and Qwen3-VL-2B-Instruct are Apache-2.0 per their model cards.
  - The Swahili-specialised AfriSLM model was not used, because its card lists financial use as out of scope.
- **What did not work:**
  - Qwen3 4B's own Swahili was unusable: repetitive, meaningless sentences.
  - So Kiswahili mode shows fixed wording written in advance (levels, categories, every rule reason, advice), and the model's free-text explanation stays in English. The card says so.

## WDK integration

- **Packages:** `@tetherto/wdk` 1.0.0-beta.22 and `@tetherto/wdk-wallet-evm` 1.0.0-beta.24, on **Sepolia (chainId 11155111)** with test USD₮. `@tetherto/wdk-wallet` is pinned to 1.0.0-beta.21 through npm `overrides`, because the two packages otherwise bring in different copies and their types do not match.
- [`packages/wallet/src/wallet.ts`](packages/wallet/src/wallet.ts): the WDK instance is created **without a provider**, so it can sign but cannot reach the network.
  - `registerPolicy` decodes the ERC-20 calldata. It denies anything that is not a USD₮ transfer, a recipient that is not saved, more than 200 USD₮ per release, and more than 500 USD₮ in any rolling 24 hours.
  - It also denies WDK's own `transfer` and `sendTransaction` outright.
  - `simulate.signTransaction` previews the policy decision before you confirm.
  - Signing uses the nonce and fees from the last network snapshot.
- [`packages/wallet/src/rpc.ts`](packages/wallet/src/rpc.ts): the only code that talks to the chain. It has two explicit steps: read the nonce and fees, and broadcast.
- **Scope, stated plainly:** on Binance P2P the seller releases from exchange escrow. Kinga's on-chain release is for sellers who trade USD₮ themselves (OTC deals, Telegram or WhatsApp groups). The receipt and ledger checks help every seller.

## Features that use the network

Everything not listed here runs offline, which is what the offline proof checks.

1. Downloading the models once (`npm run models:download`, about 4 GB).
2. **Read nonce and fees** (wallet panel): Sepolia JSON-RPC.
3. **Broadcast signed releases** (wallet panel): Sepolia JSON-RPC.
4. `npm install` and building the UI.

## Run it

**Tested on:**
- Windows 11 Home, AMD Ryzen 5 7500F, 48 GB RAM
- NVIDIA RTX 5060 Ti 16 GB, Vulkan 1.4.341
- Node.js 24.12.0

QVAC on Windows needs Vulkan 1.4 or later. The models need about 4 GB of disk and comfortably fit in 16 GB of VRAM together.

```bash
npm install
```
```bash
npm run models:download
```
```bash
npm run spike:wdk
```
```bash
npm run build:web
```
```bash
npm start
```

Then open http://127.0.0.1:8787.

- `npm run spike:wdk` creates a Sepolia test seed in `.env`; it never prints it.
- To broadcast, also set `KINGA_USDT_ADDRESS` in `.env` to the Sepolia test USD₮ contract from the faucet, and fund the address shown in the wallet panel with Sepolia ETH and test USD₮.
- `npm run demo:reset` clears the demo wallet's ledger between rehearsals.

Checks:

```bash
npm test
```
```bash
npm run eval:ledger
```
```bash
npm run eval -- --split test
```
```bash
npm run offline-proof
```

## Repository

```
packages/core     M-PESA receipt parsing, the ledger and balance chain, scam signals (S1–S25), risk fusion,
                  the release check, address-poisoning checks, Kiswahili wording
packages/ai       QVAC: message model (Qwen3 4B) and screenshot reader (Qwen3-VL 2B)
packages/wallet   WDK release gate: policies, 24 h budget, offline signing, explicit network steps
apps/server       local HTTP service, bound to 127.0.0.1 only
apps/web          Vite + React UI
eval/             datasets, eval scripts and reports
scripts/          offline proof, screenshot renderer
spikes/           first experiments and model downloads
```

## Honest limits

- **Synthetic data.** All demo messages, screenshots and the 210-message eval set are synthetic. They were written with AI assistance during development, from public reporting on Kenyan scams. No cloud AI runs at runtime. Real M-PESA formats come from secondary sources and have not been checked against real 2026 messages.
- **Clean screenshots.** The screenshots were rendered from HTML. Real phone screenshots (compressed, cropped, dark mode, edited) will be harder to read.
- **The ledger eval checks the arithmetic, not the parser.** Its histories come from Kinga's own templates. Also, the chain resets after templates it does not model (such as Fuliza auto-repayments), and it cannot prove the newest message fake until the next one arrives.
- **Desktop only.** A real product would read the SMS inbox on Android (QVAC supports Expo). Here, the inbox is demo data.
- **Kiswahili** wording was written by the developer and still needs review by a native speaker.
- **Testnet only.** Sepolia; never use a seed that holds real funds.

## What existed before

- No code was copied from earlier projects. The LICENSE text and some design principles come from the author's earlier public project Tieout_arc (October 2026, Apache-2.0): a deterministic core as the judge, ambiguous cases left to a person, and reasons recorded as notes.
- The research notes and the plan were written at the start of the hackathon.
- The first commit (`85a1449`) is the scaffold. Everything since is hackathon work.

## License

Apache-2.0. See [LICENSE](LICENSE).

# Kinga for judges (one page)

**What it is.** You are shown "I paid" with a screenshot. Kinga answers *did they really pay?* fully offline:
1. An on-device vision model (QVAC, Qwen3-VL 2B) reads the proof.
2. Your own M-PESA messages decide whether the money arrived, how much it was, and who sent it.

The AI reads; your M-PESA decides. Track: **Offline AI apps**.

## Run it (Windows 11, Node 24, Vulkan 1.4)

```bash
npm install
```
```bash
npm run models:download
```
```bash
npm run build:web
```
```bash
npm start
```

Open http://127.0.0.1:8787. Only `npm install` and the model download (about 4 GB, once) need the internet. After that, turn Wi-Fi off; everything below works.

The **Release USDT** tab is optional. To try it, run `npm run spike:wdk` once (it only writes a test seed to `.env` and does not connect), then restart.

## What to click (2 minutes)

1. **Did they really pay?**
   - Click **Grace**. You get *Edited proof*: the transaction is real but was for Ksh20, not Ksh20,000. This is the trick from two 2025 Kenyan court cases.
   - Then click **Brian** (*paid*), **Kevin** (*fake*, the code only exists in an SMS from a phone number), **Faith** (*paid by someone else*) and **Daniel** (*almost certainly fake*: the balances add up without it).
   - Try **Upload a screenshot** with one of the PNGs in `eval/data/screenshots/` and no amount: Kinga asks you to compare instead of accusing. Upload Brian's proof with an expected amount of 8,000: *underpaid*, not *edited*.
   - Press **Kiswahili** to see every verdict in Swahili.
2. **Your M-PESA ledger.** See why Daniel's message is fake even though it looks exactly like M-PESA: the balances before and after it add up without it. **Import your SMS** accepts an SMS Backup & Restore XML file.
3. **Release USDT** (optional, needs `spike:wdk`). Order **P2P-1001** passes all checks and signs offline (it needs a nonce first; see below). Then press **Demo: paste a look-alike** and watch the release get blocked.
4. **Inbox guard.** Open the message from **0712300455** ("nimetuma 2,000 kimakosa…"). It is proven fake because no Ksh2,000 ever arrived.

The model's status chips at the top say *on this device* once both models are loaded (about 10 to 30 s).

## Where QVAC is used

| What | File | Model |
|---|---|---|
| Read payment screenshots | [`packages/ai/src/vision.ts`](packages/ai/src/vision.ts) | `QWEN3VL_2B_MULTIMODAL_Q4_K` + `MMPROJ_…` |
| Read messages and chats, explain verdicts | [`packages/ai/src/index.ts`](packages/ai/src/index.ts) | `QWEN3_4B_INST_Q4_K_M` |
| Load both, one call at a time | [`apps/server/src/main.ts`](apps/server/src/main.ts) | |

The SDK is `@qvac/sdk` 0.22.0, with JSON-schema output, `temp: 0`, `ctx_size: 4096`, and models in a local cache ([`qvac.config.js`](qvac.config.js)).

## What needs the internet

1. The one-time model download.
2. **Read nonce and fees** in the Release tab's wallet panel. Do it once while online, before the offline release demo.
3. **Broadcast** a signed release (Sepolia testnet).

Nothing else connects anywhere. To check that yourself:

```bash
npm run offline-proof
```

It runs every demo flow and records every TCP connection made by Kinga's processes, including QVAC's worker. Result: **0** ([report](eval/reports/offline-proof-2026-10-29-07-57.md)). A `--control` run proves the monitor does catch a connection when one is made.

## Evidence

- **Screenshot reading:** 5 demo proofs and 6 harder variants (compressed, small, dark mode, cropped) were all read correctly.
- **Balance chain:** 1,000 histories per row; template-perfect forged "MPESA" messages were caught 0% by text rules and 100% by the ledger when the history is complete ([report](eval/reports/ledger-2026-10-28-14-35.md)).
- **Message verdicts:** on a frozen test split, rules + model catch 98.2% of scams with 8.8% false positives, against 75.0% / 2.9% for rules alone ([report](eval/reports/2026-10-28-15-02-test.md)).
- **Tests:** `npm test` runs 44 unit tests.

## Known limits

- **Synthetic data.** All data is synthetic, and M-PESA formats come from secondary sources.
- **"Not yet", never "fake", for a missing code.** M-PESA messages can be minutes late, so a missing code is reported as *not in your M-PESA yet*.
- **Balance evidence is strong, not absolute.** Missing messages can make a genuine payment look wrong, so balance-only verdicts say *almost certainly* or *balance doesn't follow* and point to *334#.
- **Old payments shown again** are flagged when a real payment arrived more than a day before the latest M-PESA message.
- **Desktop build.** A phone app would read the inbox directly; here you import an SMS export.
- **Kiswahili** wording awaits review by a native speaker.

Details are in the [README](README.md#honest-limits).

# Kinga offline proof (positive control): PASS

Run 2026-10-28T13:56:24.273Z, 32.4 s in total. Mode: positive control, a network step was run on purpose and must be seen.

- Internet reachable at start: **yes**; at end: **yes**
- Processes watched (the server and everything it started): bare.exe, node.exe, server
- Connection samples taken: 92 (every 300 ms)
- Non-loopback TCP connections from those processes: **1**

## Steps

- Model loaded from the local cache: ready 9.8 s after start
- Act 1 m01 (MPESA): safe / not_scam in 1.1 s
- Act 1 m02 (MPESA): safe / not_scam in 1.2 s
- Act 1 m03 (0745903112): scam / fake_mpesa_confirmation in 1.6 s
- Act 1 m04 (0712300455): high_risk / wrong_send_reversal in 1.4 s
- Act 1 m05 (0101223344): scam / fake_customer_care in 1.5 s
- Act 1 m06 (0733667120): high_risk / fake_loan_or_fuliza in 1.6 s
- Act 1 m07 (0722410733): safe / not_scam in 1.2 s
- Act 1 m08 (Safaricom): safe / not_scam in 1.1 s
- Act 1 m09 (MPESA): safe / not_scam in 1.1 s
- Act 1 m10 (+254711093820): high_risk / investment_or_crypto in 1.6 s
- Act 1 m11 (0798120334): high_risk / relative_impersonation in 1.5 s
- Act 2 P2P-1001: all checks pass; chat safe; 1.3 s
- Act 2 P2P-1001: signed offline (nonce 0), queued, not broadcast
- Act 2 P2P-1002: blocked at receipt; chat high_risk; 1.4 s
- Act 2 P2P-1003: blocked at receipt; chat high_risk; 1.3 s
- Control: ran the wallet's 'read nonce and fees' network step on purpose

## Connections seen

| time | process | pid | local port | remote | state |
|---|---|---|---|---|---|
| 2026-10-28T13:56:54.019Z | node.exe | 43096 | :62220 | 104.20.24.117:443 | ESTABLISHED |

## Limits

- Connections are sampled every 300 ms; one that opens and closes between samples could be missed.
- DNS lookups go through the Windows DNS Client service, not Kinga's processes, so they are not attributed here.
- The wallet's two network steps (reading the nonce, broadcasting) are deliberately not part of this run.
- The airplane-mode recording of the demo is the complementary proof for both limits.
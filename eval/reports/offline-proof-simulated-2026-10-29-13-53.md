# Kinga offline proof: PASS

Run 2026-10-29T13:53:06.373Z, 85.2 s in total. Mode: simulated offline: the machine stayed online, but every Node process of Kinga ran with scripts/block-network.cjs, which fails any connection beyond this machine as Wi-Fi off would, and logs it.

- Internet reachable at start: **yes**; at end: **yes**
- Processes watched (the server and everything it started): bare.exe, conhost.exe, node.exe, server
- Connection samples taken: 234 (every 300 ms)
- Non-loopback TCP connections from those processes: **0**
- UDP sockets opened beyond loopback by those processes: **0**
- Blocker self-test (a Node process with the same settings fetching https://1.1.1.1): failed as offline, `ENOTFOUND`
- Connection attempts by Kinga's Node processes that the blocker refused: **0**

## Steps

- Model loaded from the local cache: ready 49.3 s after start
- Proof "Grace, tenant: October rent": read UJ6R4TG8NP, Ksh20000 on device; AMOUNT_MISMATCH; 1.1 s
- Proof "Brian Otieno Ouma: buys 50 USDT": read UJ7M2QK8TA, Ksh6500 on device; paid; 0.9 s
- Proof "Kevin Mutua: buys 100 USDT": read UJ7P9XK3LC, Ksh13000 on device; FORGED_IN_INBOX, CODE_NOT_IN_INBOX; 1.0 s
- Proof "Faith Akinyi: buys 75 USDT": read UJ7N4RD2WB, Ksh9750 on device; NAME_MISMATCH; 1.3 s
- Proof "Daniel Kiprono: buys 150 USDT": read UJ8A1BC2DE, Ksh20000 on device; BALANCE_SAYS_FAKE; 1.3 s
- Act 1 m11 (0798120334): high_risk / relative_impersonation in 1.4 s
- Act 1 m10 (+254711093820): high_risk / investment_or_crypto in 1.9 s
- Act 1 m14 (MPESA): safe / not_scam in 1.3 s
- Act 1 m12 (MPESA): scam / fake_mpesa_confirmation in 1.5 s
- Act 1 m13 (MPESA): safe / not_scam in 1.4 s
- Act 1 m09 (MPESA): safe / not_scam in 1.2 s
- Act 1 m08 (Safaricom): safe / not_scam in 1.4 s
- Act 1 m07 (0722410733): safe / not_scam in 1.3 s
- Act 1 m06 (0733667120): high_risk / fake_loan_or_fuliza in 1.8 s
- Act 1 m05 (0101223344): scam / fake_customer_care in 1.6 s
- Act 1 m04 (0712300455): scam / wrong_send_reversal in 1.6 s
- Act 1 m03 (0745903112): scam / fake_mpesa_confirmation in 1.7 s
- Act 1 m02 (MPESA): safe / not_scam in 1.2 s
- Act 1 m01 (MPESA): safe / not_scam in 1.2 s
- Act 1 m00 (MPESA): safe / not_scam in 1.2 s
- Act 2 P2P-1001: all checks pass; chat safe; 1.2 s
- Act 2 P2P-1001: signed offline (nonce 0), queued, not broadcast
- Act 2 P2P-1002: blocked at receipt; chat high_risk; 1.4 s
- Act 2 P2P-1003: blocked at receipt; chat high_risk; 1.4 s
- Act 2 P2P-1004: blocked at receipt; chat high_risk; 1.7 s

## Limits

- Connections are sampled every 300 ms; one that opens and closes between samples could be missed.
- DNS lookups go through the Windows DNS Client service, not Kinga's processes, so they are not attributed here.
- The wallet's two network steps (reading the nonce, broadcasting) are deliberately not part of this run.
- The airplane-mode recording of the demo is the complementary proof for both limits.
- Simulated offline blocks Node processes only. QVAC's Bare worker (bare.exe) is not Node, so it is not blocked; it is watched for TCP connections and UDP sockets instead.
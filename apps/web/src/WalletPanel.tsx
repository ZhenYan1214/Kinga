// The only place in the UI that uses the internet, and every button here says so.
import { useState } from "react";
import { api, type WalletView } from "./api";

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function WalletPanel({ wallet, onWallet }: { wallet?: WalletView; onWallet: (w: WalletView) => void }) {
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!wallet) return null;

  async function network(step: "snapshot" | "broadcast") {
    setBusy(true);
    setNote(undefined);
    try {
      if (step === "snapshot") {
        const r = await api.snapshot();
        onWallet(r.wallet);
        setNote(`Read nonce ${r.wallet.snapshot?.nonce}. Balance ${r.eth} Sepolia ETH${r.usdt !== null ? `, ${r.usdt} test USDT` : ""}.`);
      } else {
        const r = await api.broadcast();
        onWallet(r.wallet);
        setNote(r.sent.length ? `Broadcast ${r.sent.length} release(s).` : "Nothing was broadcast; see the status of each release below.");
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const queued = wallet.releases.filter((r) => r.status === "signed").length;

  return (
    <aside className="card wallet">
      <h3>Wallet (Sepolia testnet)</h3>
      <p className="mono small">{short(wallet.address)}</p>
      <dl>
        <dt>Released in the last 24 h</dt>
        <dd>
          {wallet.spentLast24h} / {wallet.dailyBudget} USDT
        </dd>
        <dt>Last network snapshot</dt>
        <dd>{wallet.snapshot ? `nonce ${wallet.snapshot.nonce}, ${new Date(wallet.snapshot.takenAt).toLocaleString()}` : "never: go online once"}</dd>
        <dt>Saved addresses</dt>
        <dd>{wallet.allowlist.length}</dd>
      </dl>

      <div className="network-steps">
        <p className="network-label">Network steps: these use the internet</p>
        <button disabled={busy} onClick={() => network("snapshot")}>
          Read nonce and fees
        </button>
        <button disabled={busy || queued === 0 || !wallet.tokenConfigured} onClick={() => network("broadcast")}>
          Broadcast {queued} signed release{queued === 1 ? "" : "s"}
        </button>
        {!wallet.tokenConfigured && <p className="muted small">Set KINGA_USDT_ADDRESS in .env to enable broadcasting.</p>}
        {note && <p className="small">{note}</p>}
      </div>

      {wallet.releases.length > 0 && (
        <>
          <h4>Releases</h4>
          <ul className="releases">
            {wallet.releases
              .slice()
              .reverse()
              .map((r) => (
                <li key={`${r.orderId}-${r.nonce}`}>
                  <span className={`badge status-${r.status}`}>{r.status}</span> {r.amount} USDT · {r.orderId}
                  {r.txHash && (
                    <a href={`https://sepolia.etherscan.io/tx/${r.txHash}`} target="_blank" rel="noreferrer">
                      {" "}
                      view
                    </a>
                  )}
                  {r.error && <div className="bad small">{r.error}</div>}
                </li>
              ))}
          </ul>
        </>
      )}
    </aside>
  );
}

// Act 2: before releasing USDT to a P2P buyer, every check runs on this device; signing is offline too.
// Only the broadcast (in the wallet panel) touches the network.
import { useEffect, useState } from "react";
import { api, type Order, type ReleaseCheckResult, type WalletView } from "./api";
import { LevelBadge, VerdictCard } from "./VerdictCard";

type Step = { title: string; state: "pass" | "fail" | "wait"; detail: React.ReactNode };

/** walletVersion changes when the network snapshot or saved addresses change, so the policy step is re-checked. */
export function Release({ onWallet, walletVersion }: { onWallet: (w: WalletView) => void; walletVersion: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState<string>();
  const [to, setTo] = useState("");
  const [check, setCheck] = useState<ReleaseCheckResult>();
  const [checking, setChecking] = useState(false);
  const [chatAcknowledged, setChatAcknowledged] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  const order = orders.find((o) => o.id === orderId);

  useEffect(() => {
    api.orders().then((list) => {
      setOrders(list);
      setOrderId(list[0]?.id);
      setTo(list[0]?.buyerAddress ?? "");
    });
  }, []);

  async function runCheck(id = orderId, address = to) {
    if (!id) return;
    setChecking(true);
    setError(undefined);
    setChatAcknowledged(false);
    try {
      setCheck(await api.checkRelease(id, address));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (orderId) void runCheck(orderId, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, walletVersion]);

  function pick(o: Order) {
    setOrderId(o.id);
    setTo(o.buyerAddress);
    setCheck(undefined);
    setResult(undefined);
  }

  async function saveAddress() {
    if (!order) return;
    onWallet(await api.allow(`${order.buyerKycName} (verified by phone)`, to));
    await runCheck();
  }

  async function confirm() {
    if (!orderId) return;
    try {
      const { outcome, wallet } = await api.confirmRelease(orderId, to);
      onWallet(wallet);
      setResult(
        outcome.ok
          ? `Signed offline (nonce ${outcome.nonce}) and queued. Nothing has been sent yet: broadcast it from the wallet panel when you are online.`
          : `Not signed: ${outcome.reasons.join(" ")}`,
      );
      await runCheck();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const steps: Step[] = check
    ? [
        {
          title: "1. The money is in your own M-PESA inbox",
          state: check.receiptCheck.ok ? "pass" : "fail",
          detail: check.receiptCheck.ok ? (
            <>
              Found {check.receiptCheck.receipt?.code}: Ksh{check.receiptCheck.receipt?.amount?.toLocaleString()} from {check.receiptCheck.receipt?.counterparty}, matching the buyer's verified name.
            </>
          ) : (
            <ul>
              {check.receiptCheck.issues.map((i, n) => (
                <li key={n}>{i.reason}</li>
              ))}
            </ul>
          ),
        },
        {
          title: "2. The buyer's chat, read by the on-device model",
          state: check.chat.level === "safe" ? "pass" : chatAcknowledged ? "pass" : "fail",
          detail: (
            <>
              <div className="chat">
                {order?.chat.map((line, n) => (
                  <div key={n} className="bubble">
                    {line}
                  </div>
                ))}
              </div>
              <div className="row">
                <LevelBadge level={check.chat.level} />
                <span className="muted small">The model can add warnings but can never approve a release.</span>
              </div>
              {check.chat.level !== "safe" && (
                <>
                  <VerdictCard verdict={check.chat} />
                  <label className="ack">
                    <input type="checkbox" checked={chatAcknowledged} onChange={(e) => setChatAcknowledged(e.target.checked)} /> I have read this warning
                  </label>
                </>
              )}
            </>
          ),
        },
        {
          title: "3. The destination is an address you saved",
          state: check.addressVerdict.kind === "saved" ? "pass" : "fail",
          detail: (
            <>
              <input className="address" value={to} onChange={(e) => setTo(e.target.value.trim())} onBlur={() => runCheck()} spellCheck={false} />
              <div className="row buttons">
                <button className="ghost" onClick={() => (setTo(order!.buyerAddress), runCheck(orderId, order!.buyerAddress))}>
                  Buyer's address
                </button>
                <button className="ghost" onClick={() => (setTo(order!.lookalikeAddress), runCheck(orderId, order!.lookalikeAddress))}>
                  Demo: paste a look-alike
                </button>
              </div>
              <p className={check.addressVerdict.kind === "saved" ? "ok" : "bad"}>
                {check.addressVerdict.kind === "saved" ? `Saved as "${check.addressVerdict.contact?.label}".` : check.addressVerdict.reason}
              </p>
              {check.addressVerdict.kind === "new" && (
                <button className="ghost" onClick={saveAddress}>
                  I confirmed this address with the buyer by phone: save it
                </button>
              )}
            </>
          ),
        },
        {
          title: "4. Wallet policy (WDK): USDT only, saved recipient, 200 USDT per release, 500 USDT per 24 h",
          state: check.gate.ok ? "pass" : "fail",
          detail: check.gate.ok ? "The policy engine would allow this release." : check.gate.reasons.join(" "),
        },
      ]
    : [];

  const ready = steps.length > 0 && steps.every((s) => s.state === "pass");

  return (
    <div className="release">
      <div className="orders">
        {orders.map((o) => (
          <button key={o.id} className={`order ${o.id === orderId ? "active" : ""}`} onClick={() => pick(o)}>
            <strong>{o.id}</strong>
            <span>
              {o.usdt} USDT for Ksh{o.amountKsh.toLocaleString()}
            </span>
            <span className="muted small">{o.buyerKycName}</span>
          </button>
        ))}
      </div>

      {order && (
        <div className="card">
          <div className="row">
            <h3>
              Release {order.usdt} USDT to {order.buyerKycName}?
            </h3>
            <span className="muted small">Buyer says they paid with code {order.claimedCode}</span>
          </div>
          <p className="muted small">{order.story}</p>
          {checking && <p className="muted">Checking on this device…</p>}
          {error && <p className="bad">{error}</p>}
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.title} className={`step ${s.state}`}>
                <div className="step-title">
                  <span className="dot" /> {s.title}
                </div>
                <div className="step-detail">{s.detail}</div>
              </li>
            ))}
          </ol>
          <button className="primary" disabled={!ready} onClick={confirm}>
            {ready ? `Sign the ${order.usdt} USDT release offline` : "Release blocked until every check passes"}
          </button>
          {result && <p className="result">{result}</p>}
        </div>
      )}
    </div>
  );
}

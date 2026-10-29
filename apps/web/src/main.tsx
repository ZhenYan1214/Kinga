import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type InboxSource, type Status, type WalletView } from "./api";
import { Inbox } from "./Inbox";
import { Ledger } from "./Ledger";
import { Release } from "./Release";
import { Verify } from "./Verify";
import { WalletPanel } from "./WalletPanel";
import "./styles.css";

type Tab = "verify" | "ledger" | "release" | "inbox";
const TABS: [Tab, string][] = [
  ["verify", "Did they really pay?"],
  ["ledger", "Your M-PESA ledger"],
  ["release", "Release USDT"],
  ["inbox", "Inbox guard"],
];

function App() {
  const [tab, setTab] = useState<Tab>("verify");
  const [status, setStatus] = useState<Status>();

  useEffect(() => {
    const load = () => api.status().then(setStatus, () => undefined);
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const onWallet = (wallet: WalletView) => setStatus((s) => (s ? { ...s, wallet } : s));
  const onInbox = (inbox: InboxSource) => setStatus((s) => (s ? { ...s, inbox } : s));
  // Remount the inbox when the user imports their own messages or goes back to the demo data.
  const inboxKey = `${status?.inbox.source}-${status?.inbox.messages}`;
  const modelText = { ready: "on this device", loading: "loading on this device…", failed: "failed to load", disabled: "off" };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">K</span>
          <div>
            <h1>Kinga</h1>
            <p>Before you hand anything over: did they really pay? Checked on your device, against your own M-PESA.</p>
          </div>
        </div>
        <div className="chips">
          <span className={`chip ${status?.reader === "ready" ? "on" : ""}`}>Screenshot reader: {status ? modelText[status.reader] : "…"}</span>
          <span className={`chip ${status?.model === "ready" ? "on" : ""}`}>Message model: {status ? modelText[status.model] : "…"}</span>
          <span className="chip on">Nothing leaves this device</span>
        </div>
      </header>
      <nav>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className={tab === "release" ? "with-wallet" : ""}>
        {/* All stay mounted so switching tabs keeps results that are already computed. */}
        <div hidden={tab !== "verify"}>
          <Verify inboxSource={status?.inbox} />
        </div>
        <div hidden={tab !== "ledger"}>
          <Ledger source={status?.inbox} onSource={onInbox} />
        </div>
        <div hidden={tab !== "release"}>
          <Release
            onWallet={onWallet}
            walletVersion={`${status?.wallet.snapshot?.takenAt}|${status?.wallet.allowlist.length}|${status?.wallet.releases.length}`}
          />
        </div>
        <div hidden={tab !== "inbox"}>
          <Inbox key={inboxKey} />
        </div>
        {tab === "release" && <WalletPanel wallet={status?.wallet} onWallet={onWallet} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Status, type WalletView } from "./api";
import { Inbox } from "./Inbox";
import { Release } from "./Release";
import { WalletPanel } from "./WalletPanel";
import "./styles.css";

function App() {
  const [tab, setTab] = useState<"inbox" | "release">("inbox");
  const [status, setStatus] = useState<Status>();

  useEffect(() => {
    const load = () => api.status().then(setStatus, () => undefined);
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const onWallet = (wallet: WalletView) => setStatus((s) => (s ? { ...s, wallet } : s));
  const modelText = { ready: "on this device", loading: "loading on this device…", failed: "failed to load (rules only)", disabled: "off (rules only)" };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">K</span>
          <div>
            <h1>Kinga</h1>
            <p>Scam checks for M-Pesa and USDT that never leave your device</p>
          </div>
        </div>
        <div className="chips">
          <span className={`chip ${status?.model === "ready" ? "on" : ""}`}>AI model: {status ? modelText[status.model] : "…"}</span>
          <span className="chip on">Messages never leave this device</span>
        </div>
      </header>
      <nav>
        <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
          Inbox guard
        </button>
        <button className={tab === "release" ? "active" : ""} onClick={() => setTab("release")}>
          Release USDT
        </button>
      </nav>
      <main className={tab === "release" ? "with-wallet" : ""}>
        {/* Both stay mounted so switching tabs keeps verdicts that are already computed. */}
        <div hidden={tab !== "inbox"}>
          <Inbox />
        </div>
        <div hidden={tab !== "release"}>
          <Release onWallet={onWallet} walletVersion={`${status?.wallet.snapshot?.takenAt}|${status?.wallet.allowlist.length}|${status?.wallet.releases.length}`} />
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

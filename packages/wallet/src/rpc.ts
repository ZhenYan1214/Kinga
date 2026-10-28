// The only code in Kinga that talks to the network. Every call here is a deliberate, labelled network step.

export interface FeeQuote {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ChainRpc {
  pendingNonce(address: string): Promise<number>;
  feeQuote(): Promise<FeeQuote>;
  ethBalance(address: string): Promise<bigint>;
  tokenBalance(token: string, address: string): Promise<bigint>;
  sendRawTransaction(raw: string): Promise<string>;
  receiptStatus(txHash: string): Promise<"pending" | "success" | "reverted">;
}

const MIN_TIP = 100_000_000n; // 0.1 gwei

export class JsonRpc implements ChainRpc {
  private id = 0;
  constructor(private readonly urls: readonly string[], private readonly timeoutMs = 10_000) {}

  /**
   * Tries each endpoint in turn. Public endpoints also answer with errors for plan limits, so a JSON-RPC error
   * moves on to the next one too; it is reported only if every reachable endpoint refused.
   */
  private async call<T>(method: string, params: unknown[]): Promise<T> {
    let refusal: Error | undefined;
    let connectionError: unknown;
    for (const url of this.urls) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const body = (await response.json()) as { result?: T; error?: { message: string } };
        if (!body.error) return body.result as T;
        refusal = new Error(`${method}: ${body.error.message}`);
      } catch (error) {
        connectionError = error;
      }
    }
    throw refusal ?? new Error(`${method}: no RPC endpoint reachable (${(connectionError as Error)?.message ?? "unknown"})`);
  }

  async pendingNonce(address: string) {
    return Number(BigInt(await this.call<string>("eth_getTransactionCount", [address, "pending"])));
  }

  async feeQuote(): Promise<FeeQuote> {
    const [block, tip] = await Promise.all([
      this.call<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]),
      this.call<string>("eth_maxPriorityFeePerGas", []),
    ]);
    // Testnet tips can be a few wei; a floor keeps an offline-signed release from sitting unmined for hours.
    const maxPriorityFeePerGas = BigInt(tip) > MIN_TIP ? BigInt(tip) : MIN_TIP;
    // Twice the base fee leaves room for it to rise while the transaction waits in the queue.
    return { maxFeePerGas: 2n * BigInt(block.baseFeePerGas) + maxPriorityFeePerGas, maxPriorityFeePerGas };
  }

  async ethBalance(address: string) {
    return BigInt(await this.call<string>("eth_getBalance", [address, "latest"]));
  }

  async tokenBalance(token: string, address: string) {
    const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`; // balanceOf(address)
    const result = await this.call<string>("eth_call", [{ to: token, data }, "latest"]);
    return result === "0x" ? 0n : BigInt(result);
  }

  sendRawTransaction(raw: string) {
    return this.call<string>("eth_sendRawTransaction", [raw]);
  }

  async receiptStatus(txHash: string) {
    const receipt = await this.call<{ status: string } | null>("eth_getTransactionReceipt", [txHash]);
    if (!receipt) return "pending" as const;
    return receipt.status === "0x1" ? ("success" as const) : ("reverted" as const);
  }
}

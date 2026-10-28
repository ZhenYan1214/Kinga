// ERC-20 transfer calldata, built and read by hand so signing needs no provider and the policy can see the recipient.

const TRANSFER_SELECTOR = "a9059cbb"; // transfer(address,uint256)

export function encodeTransfer(to: string, amount: bigint): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error(`not an EVM address: ${to}`);
  if (amount <= 0n) throw new Error("amount must be positive");
  return `0x${TRANSFER_SELECTOR}${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
}

export function decodeTransfer(data: string | undefined): { to: string; amount: bigint } | undefined {
  const hex = data?.toLowerCase().replace(/^0x/, "");
  if (!hex || hex.length !== 8 + 128 || !hex.startsWith(TRANSFER_SELECTOR)) return undefined;
  return { to: `0x${hex.slice(8 + 24, 8 + 64)}`, amount: BigInt(`0x${hex.slice(8 + 64)}`) };
}

export function parseUnits(value: string, decimals: number): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`not an amount: ${value}`);
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  if (fraction.length > decimals) throw new Error(`more than ${decimals} decimals: ${value}`);
  return BigInt(match[1]!) * 10n ** BigInt(decimals) + BigInt(fraction || "0");
}

export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${value / base}.${fraction}` : `${value / base}`;
}

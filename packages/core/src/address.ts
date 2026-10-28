// USDT destination checks that need no network: format, network mismatch and address poisoning.

export type AddressNetwork = "tron" | "evm";

const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

export function addressNetwork(address: string): AddressNetwork | undefined {
  if (TRON.test(address)) return "tron";
  if (EVM.test(address)) return "evm";
  return undefined;
}

export interface SavedAddress {
  label: string;
  address: string;
}

export type AddressVerdict =
  | { kind: "saved"; contact: SavedAddress }
  | { kind: "poisoning"; lookalike: SavedAddress; reason: string }
  | { kind: "new"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "wrong_network"; reason: string };

const body = (a: string) => (a.startsWith("0x") ? a.slice(2).toLowerCase() : a);

/**
 * Address poisoning plants a look-alike that shares the first and last characters with an address you use,
 * hoping you copy it from your history. Wallets usually show only those characters.
 */
export function checkAddress(address: string, expected: AddressNetwork, saved: readonly SavedAddress[]): AddressVerdict {
  const network = addressNetwork(address);
  if (!network) return { kind: "invalid", reason: "This is not a valid TRON or EVM address." };
  if (network !== expected) {
    return { kind: "wrong_network", reason: `This is a ${network.toUpperCase()} address but you chose ${expected.toUpperCase()}; funds sent across networks are usually lost.` };
  }
  const exact = saved.find((s) => body(s.address) === body(address));
  if (exact) return { kind: "saved", contact: exact };
  const lookalike = saved.find((s) => {
    const a = body(address);
    const b = body(s.address);
    return a.slice(0, 4) === b.slice(0, 4) && a.slice(-4) === b.slice(-4);
  });
  if (lookalike) {
    return {
      kind: "poisoning",
      lookalike,
      reason: `This address starts and ends like your saved "${lookalike.label}" but the middle is different. It is a look-alike planted to trick you.`,
    };
  }
  return { kind: "new", reason: "You have never sent to this address. Confirm it with the recipient through a channel you trust." };
}

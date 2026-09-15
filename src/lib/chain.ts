import { defineChain } from "viem";

/**
 * Robinhood Chain (Arbitrum Orbit), chain id 4663. Every value can be
 * overridden from the environment — a seeded fork (contracts/scripts/
 * serve-fork.ts) is pointed at with NEXT_PUBLIC_RPC_URL.
 */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export const EXPLORER_URL = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://robinhoodchain.blockscout.com").replace(/\/$/, "");

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Robinhood Chain Explorer", url: EXPLORER_URL } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: false,
});

export const explorer = {
  address: (a: string) => `${EXPLORER_URL}/address/${a}`,
  tx: (h: string) => `${EXPLORER_URL}/tx/${h}`,
  token: (a: string) => `${EXPLORER_URL}/token/${a}`,
};

import type { Address } from "viem";

/**
 * Where the site points. NEXT_PUBLIC_ROLL_ADDRESS is normally injected by
 * next.config.ts from contracts/deployments/robinhood.json (written by
 * `npm run deploy:robinhood`), or set by hand in .env.local for a local node.
 * Referenced as a plain property on purpose: Next only inlines literal
 * `process.env.NEXT_PUBLIC_*` reads.
 */
const configured = process.env.NEXT_PUBLIC_ROLL_ADDRESS?.trim();

export const ROLL_ADDRESS: Address | undefined = configured && /^0x[0-9a-fA-F]{40}$/.test(configured) ? (configured as Address) : undefined;

/** Pyth on Robinhood Chain, verified 2026-09-15. */
export const PYTH_ADDRESS: Address = (process.env.NEXT_PUBLIC_PYTH_ADDRESS?.trim() as Address) || "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a";

/** True when the site talks to MockPyth on a local node (updates are made up locally). */
export const PYTH_MOCK = process.env.NEXT_PUBLIC_PYTH_MOCK === "1";

/** No contract, no claims: every number on the site is a dash until this is true. */
export const isLive = ROLL_ADDRESS !== undefined;

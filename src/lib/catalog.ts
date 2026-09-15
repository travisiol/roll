/**
 * The assets a ROLL table can be opened on, in contract order (the index is
 * the on-chain `asset` id). Shared by the site and contracts/scripts/deploy.ts
 * so both agree on the constructor arguments.
 *
 * Feed ids are Pyth price feed ids (Hermes /v2/price_feeds, read 2026-09-15).
 * Stocks use Pyth's 24/7 "Index" feeds (PYTH PRICE IN USD FOR <X> 24/7) rather
 * than the market-hours Equity.US feeds, because tables expire every day at
 * 16:00 UTC whether or not Nasdaq is open — including weekends.
 *
 * tickBps is the tick target as a fraction of the anchor price; the contract
 * rounds it to the nearest 1 / 2 / 5 × 10^k dollar step (log-nearest). At
 * BTC 79,720 and 35 bps the target is $279 → a $200 tick. halfWidth is the
 * number of numbered cells on each side of the anchor.
 */
export type AssetKind = "crypto" | "stock";

export type CatalogAsset = {
  symbol: string;
  name: string;
  kind: AssetKind;
  /** 0x-prefixed 32-byte Pyth feed id. */
  feedId: `0x${string}`;
  /** Pyth's own symbol for the feed, for the record. */
  pythSymbol: string;
  tickBps: number;
  halfWidth: number;
};

export const ASSETS: readonly CatalogAsset[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    pythSymbol: "Crypto.BTC/USD",
    tickBps: 35,
    halfWidth: 19,
  },
  {
    symbol: "ETH",
    name: "Ether",
    kind: "crypto",
    feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    pythSymbol: "Crypto.ETH/USD",
    tickBps: 35,
    halfWidth: 19,
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    kind: "stock",
    feedId: "0xa470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852",
    pythSymbol: "Equity.Index.NVDA/USD",
    tickBps: 50,
    halfWidth: 19,
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    kind: "stock",
    feedId: "0xe6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0",
    pythSymbol: "Equity.Index.TSLA/USD",
    tickBps: 50,
    halfWidth: 19,
  },
  {
    symbol: "HOOD",
    name: "Robinhood",
    kind: "stock",
    feedId: "0x4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630",
    pythSymbol: "Equity.Index.HOOD/USD",
    tickBps: 70,
    halfWidth: 19,
  },
  {
    symbol: "MSTR",
    name: "Strategy",
    kind: "stock",
    feedId: "0x109b49ea13e04334cb570ba3b0fb1a18d500d8eeaf32ad1987816eb4bb26d8f3",
    pythSymbol: "Equity.Index.MSTR/USD",
    tickBps: 70,
    halfWidth: 19,
  },
] as const;

export function assetIndex(symbol: string): number {
  return ASSETS.findIndex((a) => a.symbol.toLowerCase() === symbol.toLowerCase());
}

/** Constructor tuple, in the contract's field order. */
export function assetTuples(): { feedId: `0x${string}`; symbol: string; tickBps: number; halfWidth: number }[] {
  return ASSETS.map((a) => ({ feedId: a.feedId, symbol: a.symbol, tickBps: a.tickBps, halfWidth: a.halfWidth }));
}

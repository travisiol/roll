import { NextResponse } from "next/server";
import { parseAbi } from "viem";
import { ASSETS } from "@/lib/catalog";
import { PYTH_ADDRESS } from "@/lib/contracts";
import { fetchLatest, hermesConfigured } from "@/lib/hermes";
import { serverClient } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

export type PriceQuote = { price: number; publishTime: number };
export type PricesResponse = {
  /** "hermes": live from Pyth's price service. "chain": the last print stored in the Pyth contract — may be old. */
  source: "hermes" | "chain";
  prices: Record<string, PriceQuote | null>;
  now: number;
};

const pythAbi = parseAbi([
  "function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))",
  "function priceFeedExists(bytes32 id) view returns (bool)",
]);

let cache: { at: number; body: PricesResponse } | undefined;
const TTL_MS = 2_500;

async function fromHermes(): Promise<PricesResponse> {
  const upd = await fetchLatest(ASSETS.map((a) => a.feedId));
  const prices: Record<string, PriceQuote | null> = {};
  for (const a of ASSETS) {
    const p = upd.parsed.find((x) => x.id.toLowerCase() === a.feedId.toLowerCase());
    prices[a.symbol] = p ? { price: p.price, publishTime: p.publishTime } : null;
  }
  return { source: "hermes", prices, now: Math.floor(Date.now() / 1000) };
}

async function fromChain(): Promise<PricesResponse> {
  const client = serverClient();
  const prices: Record<string, PriceQuote | null> = {};
  const results = await Promise.all(
    ASSETS.map(async (a) => {
      try {
        const exists = await client.readContract({ address: PYTH_ADDRESS, abi: pythAbi, functionName: "priceFeedExists", args: [a.feedId] });
        if (!exists) return null;
        const p = await client.readContract({ address: PYTH_ADDRESS, abi: pythAbi, functionName: "getPriceUnsafe", args: [a.feedId] });
        return { price: Number(p.price) * 10 ** p.expo, publishTime: Number(p.publishTime) };
      } catch {
        return null;
      }
    }),
  );
  ASSETS.forEach((a, i) => (prices[a.symbol] = results[i]));
  return { source: "chain", prices, now: Math.floor(Date.now() / 1000) };
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);
  let body: PricesResponse;
  try {
    body = hermesConfigured ? await fromHermes() : await fromChain();
  } catch {
    body = await fromChain().catch(() => ({ source: "chain" as const, prices: {}, now: Math.floor(Date.now() / 1000) }));
  }
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

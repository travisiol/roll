import { NextResponse, type NextRequest } from "next/server";
import { encodeAbiParameters, parseAbi } from "viem";
import { ASSETS, assetIndex } from "@/lib/catalog";
import { PYTH_ADDRESS, PYTH_MOCK } from "@/lib/contracts";
import { fetchAt, fetchLatest, hermesConfigured } from "@/lib/hermes";
import { serverClient } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

/**
 * Pyth update data for a transaction: the latest print (to open a table) or
 * the first print at or after `at` (to settle one). Served through the site
 * so the Hermes key never reaches the browser. Anyone with their own key can
 * skip this and call the contract directly.
 *
 * Against a local node (NEXT_PUBLIC_PYTH_MOCK=1) the update is made up here
 * from the price stored in MockPyth, with a small deterministic drift for
 * settlements, so the whole flow can be played without a key.
 */
export type UpdateResponse = { data: `0x${string}`[]; publishTime: number; price: number; source: "hermes" | "mock" };

const mockAbi = parseAbi(["function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"]);

async function mockUpdate(asset: number, at: number | null): Promise<UpdateResponse> {
  const client = serverClient();
  const a = ASSETS[asset];
  const stored = await client.readContract({ address: PYTH_ADDRESS, abi: mockAbi, functionName: "getPriceUnsafe", args: [a.feedId] });
  const base = Number(stored.price) * 10 ** stored.expo;
  let publishTime: number;
  let price: number;
  if (at === null) {
    // a print "now": mine a block so the timestamp is the chain's present
    await client.request({ method: "evm_mine" as never, params: [] as never });
    const block = await client.getBlock();
    publishTime = Number(block.timestamp);
    price = base;
  } else {
    publishTime = at;
    const h = ((Math.floor(at / 86_400) + asset * 7) % 11) - 5; // -5..5
    price = base * (1 + h * 0.0015);
  }
  const units = BigInt(Math.round(price * 1e8));
  const data = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "int64" }, { type: "uint64" }, { type: "int32" }, { type: "uint64" }, { type: "uint64" }],
    [a.feedId, units, 0n, -8, BigInt(publishTime), BigInt(publishTime - 1)],
  );
  return { data: [data], publishTime, price, source: "mock" };
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("asset") ?? "";
  const asset = assetIndex(symbol);
  if (asset < 0) return NextResponse.json({ error: "unknown asset" }, { status: 400 });
  const atParam = req.nextUrl.searchParams.get("at");
  const at = atParam ? Number(atParam) : null;
  if (at !== null && !Number.isInteger(at)) return NextResponse.json({ error: "bad timestamp" }, { status: 400 });

  try {
    if (PYTH_MOCK) return NextResponse.json(await mockUpdate(asset, at));
    if (!hermesConfigured) {
      return NextResponse.json(
        { error: "This site has no Pyth Hermes key, so it cannot fetch price updates. Settle or open with your own key (see README), or ask the operator to set PYTH_API_KEY." },
        { status: 503 },
      );
    }
    const feed = ASSETS[asset].feedId;
    const upd = at === null ? await fetchLatest([feed]) : await fetchAt(feed, at);
    const p = upd.parsed[0];
    const body: UpdateResponse = { data: upd.data, publishTime: p?.publishTime ?? 0, price: p?.price ?? 0, source: "hermes" };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { PYTH_MOCK } from "@/lib/contracts";
import { serverClient } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

/**
 * Local-node clock control, only when the site runs against MockPyth:
 * POST { to: <unix seconds> } mines a block at that time (never backwards).
 * Lets a table be played to expiry in a minute instead of a day.
 */
export async function POST(req: NextRequest) {
  if (!PYTH_MOCK) return NextResponse.json({ error: "not a local table" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { to?: number };
  const to = Number(body.to);
  if (!Number.isInteger(to)) return NextResponse.json({ error: "to: unix seconds" }, { status: 400 });
  const client = serverClient();
  const latest = await client.getBlock();
  if (to > Number(latest.timestamp)) {
    await client.request({ method: "evm_setNextBlockTimestamp" as never, params: [to] as never });
  }
  await client.request({ method: "evm_mine" as never, params: [] as never });
  const block = await client.getBlock();
  return NextResponse.json({ now: Number(block.timestamp) });
}

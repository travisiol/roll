/**
 * Server-side Hermes client. Hermes (Pyth's price service) has required an
 * API key since 2026-08-26; the key stays on the server and the browser
 * talks to /api/prices and /api/pyth/update instead.
 */
const HERMES = (process.env.HERMES_URL ?? "https://hermes.pyth.network").replace(/\/$/, "");
const KEY = process.env.PYTH_API_KEY?.trim();

export const hermesConfigured = Boolean(KEY);

export type HermesPrice = { id: string; price: number; expo: number; publishTime: number; prevPublishTime?: number };
export type HermesUpdate = { data: `0x${string}`[]; parsed: HermesPrice[] };

type HermesBody = {
  binary: { encoding: string; data: string[] };
  parsed?: { id: string; price: { price: string; expo: number; publish_time: number }; metadata?: { prev_publish_time?: number } }[];
};

async function call(pathname: string, feedIds: readonly string[]): Promise<HermesUpdate> {
  if (!KEY) throw new Error("PYTH_API_KEY is not set");
  const qs = feedIds.map((id) => `ids[]=${id.replace(/^0x/, "")}`).join("&");
  const res = await fetch(`${HERMES}${pathname}?${qs}&encoding=hex&parsed=true`, {
    headers: { Authorization: `Bearer ${KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as HermesBody;
  return {
    data: body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`) as `0x${string}`),
    parsed: (body.parsed ?? []).map((p) => ({
      id: `0x${p.id.replace(/^0x/, "")}`,
      price: Number(p.price.price) * 10 ** p.price.expo,
      expo: p.price.expo,
      publishTime: p.price.publish_time,
      prevPublishTime: p.metadata?.prev_publish_time,
    })),
  };
}

/** Latest update for the feeds — for live prices and for opening a table. */
export function fetchLatest(feedIds: readonly string[]): Promise<HermesUpdate> {
  return call("/v2/updates/price/latest", feedIds);
}

/** The first update at or after `publishTime` — the settlement print. */
export function fetchAt(feedId: string, publishTime: number): Promise<HermesUpdate> {
  return call(`/v2/updates/price/${publishTime}`, [feedId]);
}

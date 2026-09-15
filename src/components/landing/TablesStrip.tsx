"use client";

import Link from "next/link";
import { ASSETS, type CatalogAsset } from "@/lib/catalog";
import { isLive } from "@/lib/contracts";
import { fmtCountdown, fmtEth, fmtExpiry, fmtPrice, fmtUsd } from "@/lib/format";
import { useChainNow, usePrices, useTable } from "@/lib/hooks";
import { currentExpiry, layoutFor, LOCK, usd } from "@/lib/layout";
import type { PriceQuote } from "@/app/api/prices/route";

export function TablesStrip() {
  const now = useChainNow();
  const prices = usePrices();
  const expiry = currentExpiry(now);
  return (
    <section id="tables" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display text-3xl sm:text-4xl">Tables</h2>
          <p className="mt-2 text-ash">One per asset, every day. Expiry {fmtExpiry(expiry)}, rolls close one hour before.</p>
        </div>
        <span className="chip">
          {prices.data?.source === "hermes" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-red" /> live prices · Pyth
            </>
          ) : prices.data?.source === "chain" ? (
            <>last prints stored on chain</>
          ) : (
            <>prices…</>
          )}
        </span>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ASSETS.map((a, i) => (
          <TableCard key={a.symbol} asset={a} index={i} expiry={expiry} now={now} quote={prices.data?.prices[a.symbol] ?? null} priceSource={prices.data?.source} />
        ))}
      </div>
    </section>
  );
}

function TableCard({
  asset,
  index,
  expiry,
  now,
  quote,
  priceSource,
}: {
  asset: CatalogAsset;
  index: number;
  expiry: number;
  now: number;
  quote: PriceQuote | null;
  priceSource?: "hermes" | "chain";
}) {
  const { table } = useTable(index, expiry);
  const open = Boolean(table) && table!.status === 0;
  const closesIn = expiry - LOCK - now;
  const preview = quote ? layoutFor(usd(quote.price), asset.tickBps, asset.halfWidth) : undefined;
  const tick = table?.tick ?? preview?.tick;
  const stale = quote ? now - quote.publishTime > 120 : false;

  return (
    <Link href={`/table/${asset.symbol.toLowerCase()}`} className="card group flex flex-col gap-4 p-5 transition-colors hover:border-line-2">
      <div className="flex items-start justify-between">
        <div>
          <div className="wide text-lg">{asset.symbol}</div>
          <div className="text-sm text-smoke">
            {asset.name} · {asset.kind === "stock" ? "tokenized stock" : "crypto"}
          </div>
        </div>
        <span className="chip">
          {!isLive ? (
            "awaiting launch"
          ) : open ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-red" /> open
            </>
          ) : (
            "opens with your roll"
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <div className="text-smoke">price</div>
          <div className="num text-bone">
            {quote ? fmtUsd(quote.price) : "—"}
            {quote && stale && priceSource === "chain" ? <span className="ml-1 text-xs text-smoke">old print</span> : null}
          </div>
        </div>
        <div>
          <div className="text-smoke">numbers</div>
          <div className="num text-bone">{tick ? `${fmtPrice(tick)} apart` : "—"}</div>
        </div>
        <div>
          <div className="text-smoke">pot</div>
          <div className="num text-bone">
            {table ? fmtEth(table.pot + table.carry) : isLive ? "0 ETH" : "—"}
            {table && table.carry > 0n ? <span className="ml-1 text-xs text-red">incl. {fmtEth(table.carry)} rolled</span> : null}
          </div>
        </div>
        <div>
          <div className="text-smoke">closes in</div>
          <div className="num text-bone">{isLive ? fmtCountdown(closesIn) || "locked" : "—"}</div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between text-sm">
        <span className="text-smoke">{fmtExpiry(expiry)}</span>
        <span className="text-ash transition-colors group-hover:text-bone">pick the price →</span>
      </div>
    </Link>
  );
}

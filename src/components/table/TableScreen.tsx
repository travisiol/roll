"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ASSETS } from "@/lib/catalog";
import { isLive } from "@/lib/contracts";
import { fmtCountdown, fmtEth, fmtExpiry, fmtMultiple, fmtPrice, fmtUsd } from "@/lib/format";
import { useChainNow, usePrices, useRakeBps, useRecentTables, useTable } from "@/lib/hooks";
import { BELOW, cellCentre, currentExpiry, layoutFor, LOCK, quote as quoteRoll, usd, type Layout } from "@/lib/layout";
import { parseEther } from "viem";
import { History } from "./History";
import { Ladder, type Selection } from "./Ladder";
import { MyRolls } from "./MyRolls";
import { Settle } from "./Settle";
import { Ticket } from "./Ticket";

/** One asset, today's table: the ladder is the page, the ticket sits beside it. */
export function TableScreen({ asset }: { asset: number }) {
  const a = ASSETS[asset];
  const now = useChainNow();
  const expiry = currentExpiry(now);
  const { id, table, weights, refetch } = useTable(asset, expiry);
  const recent = useRecentTables(asset, expiry, 7);
  const prices = usePrices();
  const rakeBps = useRakeBps();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [stake, setStake] = useState("0.01");

  const live = prices.data?.prices[a.symbol] ?? null;
  const livePrice = live ? usd(live.price) : undefined;
  const layout: Layout | undefined = useMemo(() => {
    if (table) return { anchor: table.anchor, tick: table.tick, cells: table.cells };
    if (livePrice !== undefined) return layoutFor(livePrice, a.tickBps, a.halfWidth);
    return undefined;
  }, [table, livePrice, a.tickBps, a.halfWidth]);

  let stakeWei = 0n;
  try {
    stakeWei = stake.trim() ? parseEther(stake.trim()) : 0n;
  } catch {
    stakeWei = 0n;
  }
  const quote = selection && layout ? quoteRoll(stakeWei, selection.lo, selection.hi, weights, table?.pot ?? 0n, table?.carry ?? 0n, rakeBps) : undefined;
  const closesIn = expiry - LOCK - now;
  const pot = (table?.pot ?? 0n) + (table?.carry ?? 0n);
  const stalePrice = live ? now - live.publishTime > 120 : false;

  const refreshAll = () => {
    refetch();
    recent.refetch();
  };

  const pickLabel = (): string => {
    if (!selection || !layout) return "";
    const name = (c: number) => (c === BELOW ? "below" : c === layout.cells - 1 ? "above" : fmtPrice(cellCentre(layout, c)));
    return selection.lo === selection.hi ? name(selection.lo) : `${name(selection.lo)} → ${name(selection.hi)}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-smoke">
        <Link href="/#tables" className="hover:text-bone">
          Tables
        </Link>
        <span>/</span>
        <span className="text-ash">{a.symbol}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl sm:text-4xl">
            {a.symbol} <span className="chrome-text">table</span>
          </h1>
          <p className="mt-1 text-ash">
            {a.name} · expiry {fmtExpiry(expiry)}
            {isLive ? (closesIn > 0 ? ` · closes in ${fmtCountdown(closesIn)}` : " · closed, settles at expiry") : ""}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-x-6 text-sm">
          <div>
            <div className="text-smoke">price</div>
            <div className="num text-bone">
              {live ? fmtUsd(live.price) : "—"}
              {live && stalePrice && prices.data?.source === "chain" ? <span className="ml-1 text-xs text-smoke">old print</span> : null}
            </div>
          </div>
          <div>
            <div className="text-smoke">pot</div>
            <div className="num text-bone">
              {table ? fmtEth(pot) : isLive ? "0 ETH" : "—"}
              {table && table.carry > 0n ? <span className="ml-1 text-xs text-red">+{fmtEth(table.carry)} rolled</span> : null}
            </div>
          </div>
          <div>
            <div className="text-smoke">numbers</div>
            <div className="num text-bone">{layout ? `${fmtPrice(layout.tick)} apart` : "—"}</div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="card p-2 sm:p-3">
          {layout ? (
            <>
              <Ladder
                layout={layout}
                weights={weights}
                selection={selection}
                onSelect={setSelection}
                livePrice={livePrice}
                quote={quote}
                disabled={!isLive || closesIn <= 0}
              />
              {!table ? (
                <p className="px-3 pb-2 pt-3 text-xs text-smoke">
                  {isLive
                    ? "No table yet for this expiry: this layout is drawn on the current price and is fixed by the print at the moment the first roll opens it."
                    : "Preview drawn on the last price known. The tables open at launch."}
                </p>
              ) : null}
            </>
          ) : (
            <p className="p-6 text-ash">
              {prices.isLoading ? "Reading the price…" : "No price is known for this asset yet, so there is no layout to draw. The first roll after launch will open it on the Pyth print."}
            </p>
          )}
        </div>

        <div id="ticket" className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Ticket
            asset={asset}
            symbol={a.symbol}
            expiry={expiry}
            now={now}
            tableId={id}
            table={table}
            weights={weights}
            layout={layout}
            selection={selection}
            onClear={() => setSelection(null)}
            stake={stake}
            onStake={setStake}
            rakeBps={rakeBps}
            onDone={refreshAll}
          />
          {isLive ? <Settle symbol={a.symbol} recent={recent.tables[0]} now={now} onChanged={refreshAll} /> : null}
          {isLive ? <MyRolls asset={asset} onChanged={refreshAll} /> : null}
          {isLive ? <History tables={recent.tables} /> : null}
        </div>
      </div>

      {/* phones: the pick follows you to the ticket */}
      {selection && quote ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-black/90 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="num truncate text-sm text-bone">{pickLabel()}</div>
              <div className="num text-xs text-ash">
                {selection.lo === selection.hi ? fmtMultiple(quote.payouts[0].multiple) : `${fmtMultiple(quote.min)} – ${fmtMultiple(quote.max)}`} · {fmtEth(stakeWei)}
              </div>
            </div>
            <button type="button" className="btn btn-red btn-sm" onClick={() => document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              To the ticket
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

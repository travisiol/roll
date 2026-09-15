"use client";

import { useRef } from "react";
import { fmtEth, fmtMultiple, fmtPrice } from "@/lib/format";
import { BELOW, cellBounds, cellOf, type Layout, type Quote } from "@/lib/layout";

export type Selection = { lo: number; hi: number };

/**
 * The layout as a ladder: ABOVE on top, the numbers descending, BELOW at
 * the bottom — up is up. Odd numbers are red, even ones bone, the way a
 * wheel alternates. One click is a straight-up; a second click on another
 * row (or a drag) makes the zone between them.
 */
export function Ladder({
  layout,
  weights,
  selection,
  onSelect,
  livePrice,
  winningCell,
  quote,
  disabled,
}: {
  layout: Layout;
  weights: readonly bigint[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  livePrice?: bigint;
  winningCell?: number;
  quote?: Quote;
  disabled?: boolean;
}) {
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const above = layout.cells - 1;
  const liveCell = livePrice !== undefined ? cellOf(layout, livePrice) : undefined;
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  const maxWeight = weights.reduce((a, b) => (b > a ? b : a), 0n);
  const quoteByCell = new Map(quote?.payouts.map((p) => [p.cell, p.multiple]));

  const range = (a: number, b: number): Selection => ({ lo: Math.min(a, b), hi: Math.max(a, b) });

  const down = (cell: number) => {
    if (disabled) return;
    dragging.current = true;
    if (selection && selection.lo === selection.hi && cell !== selection.lo) {
      anchor.current = selection.lo;
      onSelect(range(selection.lo, cell));
    } else if (selection && selection.lo === selection.hi && cell === selection.lo) {
      anchor.current = null;
      onSelect(null);
    } else {
      anchor.current = cell;
      onSelect({ lo: cell, hi: cell });
    }
  };
  const enter = (cell: number) => {
    if (!dragging.current || anchor.current === null) return;
    onSelect(range(anchor.current, cell));
  };
  const up = () => {
    dragging.current = false;
    anchor.current = null;
  };

  const rows: number[] = [above];
  for (let c = above - 1; c >= 1; c--) rows.push(c);
  rows.push(BELOW);

  return (
    <div className="select-none" onPointerUp={up} onPointerLeave={up} role="listbox" aria-label="price layout" aria-multiselectable>
      <div className="row cursor-default text-xs text-smoke hover:bg-transparent" aria-hidden>
        <span>cell</span>
        <span className="truncate">price · lands if the print is in this tick</span>
        <span className="text-right">on it</span>
        <span className="text-right">pays</span>
      </div>
      {rows.map((cell) => {
        const green = cell === BELOW || cell === above;
        const picked = selection !== null && cell >= selection.lo && cell <= selection.hi;
        const w = weights[cell] ?? 0n;
        const share = totalWeight > 0n ? Number((w * 10_000n) / totalWeight) / 100 : 0;
        const bar = maxWeight > 0n ? Number((w * 1000n) / maxWeight) / 10 : 0;
        const odd = cell % 2 === 1;
        let label: string;
        let sub = "";
        if (cell === BELOW) {
          label = "below";
          sub = `under ${fmtPrice(cellBounds(layout, 1).lower)}`;
        } else if (cell === above) {
          label = "above";
          sub = `from ${fmtPrice(cellBounds(layout, above - 1).upper)}`;
        } else {
          const b = cellBounds(layout, cell);
          label = fmtPrice(b.lower + layout.tick / 2n);
          sub = `≥ ${fmtPrice(b.lower)} · < ${fmtPrice(b.upper)}`;
        }
        const multiple = quoteByCell.get(cell);
        const classes = ["row"];
        if (green) classes.push("row-green");
        if (picked) classes.push("row-picked");
        if (winningCell === cell) classes.push("row-won");
        if (liveCell === cell && winningCell === undefined) classes.push("row-live");
        return (
          <div
            key={cell}
            className={classes.join(" ")}
            style={{ touchAction: "pan-y" }}
            role="option"
            aria-selected={picked}
            data-cell={cell}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              down(cell);
            }}
            onPointerEnter={() => enter(cell)}
          >
            <span className="num text-xs text-smoke">{green ? "" : cell}</span>
            <span className="flex min-w-0 items-baseline gap-2 overflow-hidden">
              <span className={`num text-[14px] ${green ? "text-green" : odd ? "text-red" : "text-bone"}`}>{label}</span>
              <span className="num hidden truncate text-xs text-smoke sm:inline">{sub}</span>
              {liveCell === cell && winningCell === undefined ? <span className="ml-auto text-[11px] text-chrome">live</span> : null}
              {winningCell === cell ? <span className="ml-auto text-[11px] text-chrome">landed</span> : null}
            </span>
            <span className="flex items-center justify-end gap-2">
              {w > 0n ? (
                <>
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-felt-3 sm:block">
                    <span className="block h-full rounded-full bg-chrome" style={{ width: `${Math.max(bar, 4)}%` }} />
                  </span>
                  <span className="num text-xs text-ash" title={`${share}% of the weight on the table`}>
                    {fmtEth(w, 3).replace(" ETH", "")}
                  </span>
                </>
              ) : (
                <span className="num text-xs text-smoke">—</span>
              )}
            </span>
            <span className={`num text-right text-xs ${multiple !== undefined ? "text-bone" : "text-smoke"}`}>{multiple !== undefined ? fmtMultiple(multiple) : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

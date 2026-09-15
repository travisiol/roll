"use client";

import { fmtDate, fmtEth, fmtPrice } from "@/lib/format";
import type { RecentTable } from "@/lib/hooks";
import { BELOW, cellCentre } from "@/lib/layout";

/** The asset's last tables, one line each. */
export function History({ tables }: { tables: RecentTable[] }) {
  const rows = tables.filter((r) => r.table);
  if (rows.length === 0) return null;
  return (
    <div className="card p-5">
      <h2 className="display text-xl">Past tables</h2>
      <ul className="mt-3 divide-y divide-line text-sm">
        {rows.map(({ expiry, id, table: t }) => {
          if (!t) return null;
          const green = t.winningCell === BELOW || t.winningCell === t.cells - 1;
          return (
            <li key={id.toString()} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="num truncate">
                  {t.status === 1 ? (
                    <>
                      <span className={green ? "text-green" : "text-red"}>
                        {green ? (t.winningCell === BELOW ? "below" : "above") : fmtPrice(cellCentre({ anchor: t.anchor, tick: t.tick, cells: t.cells }, t.winningCell))}
                      </span>
                      <span className="text-smoke"> · print {fmtPrice(t.settlePrice)}</span>
                    </>
                  ) : t.status === 2 ? (
                    <span className="text-ash">voided · refunds</span>
                  ) : (
                    <span className="text-ash">unsettled</span>
                  )}
                </div>
                <div className="text-xs text-smoke">{fmtDate(expiry)}</div>
              </div>
              <span className="num shrink-0 text-right text-xs text-ash">
                {t.status === 1 ? (t.payoutPool > 0n ? `${fmtEth(t.payoutPool)} paid` : `${fmtEth(t.pot + t.carry)} rolled`) : fmtEth(t.pot + t.carry)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

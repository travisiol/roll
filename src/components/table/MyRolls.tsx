"use client";

import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { rollAbi } from "@/lib/abi/roll";
import { ROLL_ADDRESS } from "@/lib/contracts";
import { fmtDate, fmtEth, fmtPrice } from "@/lib/format";
import { useMyRolls, type RollView, type TableView } from "@/lib/hooks";
import { BELOW, cellBounds, type Layout } from "@/lib/layout";
import { explain } from "@/lib/tx";

function pick(layout: Layout, r: RollView): string {
  const above = layout.cells - 1;
  const name = (c: number) => (c === BELOW ? "below" : c === above ? "above" : fmtPrice(cellBounds(layout, c).lower + layout.tick / 2n));
  return r.lo === r.hi ? name(r.lo) : `${name(r.lo)} → ${name(r.hi)}`;
}

function layoutOf(t: TableView): Layout {
  return { anchor: t.anchor, tick: t.tick, cells: t.cells };
}

/** The wallet's rolls on this asset, every table, with what each is owed. */
export function MyRolls({ asset, onChanged }: { asset: number; onChanged: () => void }) {
  const { rolls, tableById, refetch } = useMyRolls();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = rolls.filter((r) => tableById.get(r.tableId.toString())?.asset === asset);
  if (mine.length === 0) return null;
  const claimable = mine.filter((r) => r.owed > 0n && !r.claimed);
  const total = claimable.reduce((a, r) => a + r.owed, 0n);

  const claimAll = async () => {
    if (!ROLL_ADDRESS || !publicClient || claimable.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ids = claimable.map((r) => r.id);
      const hash =
        ids.length === 1
          ? await writeContractAsync({ address: ROLL_ADDRESS, abi: rollAbi, functionName: "claim", args: [ids[0]] })
          : await writeContractAsync({ address: ROLL_ADDRESS, abi: rollAbi, functionName: "claimMany", args: [ids] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      refetch();
      onChanged();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="display text-xl">Your rolls</h2>
        {claimable.length > 0 ? (
          <button type="button" className="btn btn-chrome btn-sm" disabled={busy} onClick={claimAll}>
            {busy ? "Claiming…" : `Claim ${fmtEth(total)}`}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red">{error}</p> : null}
      <ul className="mt-3 divide-y divide-line">
        {mine.map((r) => {
          const t = tableById.get(r.tableId.toString());
          if (!t) return null;
          const layout = layoutOf(t);
          const won = t.status === 1 && t.winningCell >= r.lo && t.winningCell <= r.hi;
          const state =
            t.status === 0
              ? "open"
              : t.status === 2
                ? r.claimed
                  ? "refunded"
                  : "void · refund"
                : won
                  ? r.claimed
                    ? "paid"
                    : "landed"
                  : "missed";
          return (
            <li key={r.id.toString()} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="num truncate text-bone">{pick(layout, r)}</div>
                <div className="text-xs text-smoke">
                  {fmtDate(Number(t.expiry))} · {fmtEth(r.stake)}
                </div>
              </div>
              <div className="text-right">
                <div className={`num ${won && !r.claimed ? "text-red" : "text-ash"}`}>{r.owed > 0n && !r.claimed ? `+${fmtEth(r.owed)}` : ""}</div>
                <div className="text-xs text-smoke">{state}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

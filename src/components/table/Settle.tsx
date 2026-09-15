"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { pythAbi } from "@/lib/abi/pyth";
import { rollAbi } from "@/lib/abi/roll";
import { PYTH_ADDRESS, ROLL_ADDRESS } from "@/lib/contracts";
import { fmtDate, fmtEth, fmtPrice } from "@/lib/format";
import type { RecentTable } from "@/lib/hooks";
import { BELOW, cellCentre, VOID_AFTER } from "@/lib/layout";
import { explain, fetchUpdate } from "@/lib/tx";

/** The last table before today's: waiting for its print, settled, or void. */
export function Settle({ symbol, recent, now, onChanged }: { symbol: string; recent: RecentTable | undefined; now: number; onChanged: () => void }) {
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<"idle" | "update" | "wallet" | "mining">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!recent?.table) return null;
  const t = recent.table;
  const voidable = t.status === 0 && now > recent.expiry + VOID_AFTER;

  const run = async (what: "settle" | "void") => {
    if (!ROLL_ADDRESS || !publicClient) return;
    setError(null);
    try {
      let hash: `0x${string}`;
      if (what === "settle") {
        setBusy("update");
        const upd = await fetchUpdate(symbol, recent.expiry);
        const fee = await publicClient.readContract({ address: PYTH_ADDRESS, abi: pythAbi, functionName: "getUpdateFee", args: [upd.data] });
        setBusy("wallet");
        hash = await writeContractAsync({ address: ROLL_ADDRESS, abi: rollAbi, functionName: "settle", args: [recent.id, upd.data], value: fee });
      } else {
        setBusy("wallet");
        hash = await writeContractAsync({ address: ROLL_ADDRESS, abi: rollAbi, functionName: "voidTable", args: [recent.id] });
      }
      setBusy("mining");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      onChanged();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy("idle");
    }
  };

  const label = (cell: number) =>
    cell === BELOW ? "below the layout" : cell === t.cells - 1 ? "above the layout" : fmtPrice(cellCentre({ anchor: t.anchor, tick: t.tick, cells: t.cells }, cell));

  return (
    <div className="card p-5">
      <div className="text-sm text-smoke">{fmtDate(recent.expiry)} · 16:00 UTC</div>
      {t.status === 1 ? (
        <>
          <div className="num mt-1 text-[15px] text-bone">
            Landed on <span className={t.winningCell === BELOW || t.winningCell === t.cells - 1 ? "text-green" : "text-red"}>{label(t.winningCell)}</span>
            <span className="text-smoke"> · print {fmtPrice(t.settlePrice)}</span>
          </div>
          <div className="mt-1 text-sm text-ash">
            {t.payoutPool > 0n ? `${fmtEth(t.payoutPool)} paid to the cell.` : `Nobody was on it: ${fmtEth(t.pot + t.carry)} rolled into today's table.`}
          </div>
        </>
      ) : t.status === 2 ? (
        <>
          <div className="num mt-1 text-[15px] text-bone">Voided</div>
          <div className="mt-1 text-sm text-ash">No print was submitted in three days; every roll can be refunded from “Your rolls”.</div>
        </>
      ) : now >= recent.expiry ? (
        <>
          <div className="num mt-1 text-[15px] text-bone">Waiting for its print</div>
          <div className="mt-1 text-sm text-ash">
            {fmtEth(t.pot + t.carry)} on the table. Anyone can settle it with the first Pyth print at or after 16:00 UTC — the print, not the settler, decides.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-chrome btn-sm" disabled={!isConnected || busy !== "idle"} onClick={() => run("settle")}>
              {busy === "update" ? "Fetching the print…" : busy === "wallet" ? "Confirm in your wallet…" : busy === "mining" ? "Settling…" : "Settle with the 16:00 print"}
            </button>
            {voidable ? (
              <button type="button" className="btn btn-line btn-sm" disabled={!isConnected || busy !== "idle"} onClick={() => run("void")}>
                Void & refund
              </button>
            ) : null}
          </div>
          {!isConnected ? <p className="mt-2 text-xs text-smoke">Connect a wallet to send the settlement.</p> : null}
          {error ? <p className="mt-2 text-sm text-red">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}

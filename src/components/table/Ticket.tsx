"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, useBalance, usePublicClient, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { pythAbi } from "@/lib/abi/pyth";
import { rollAbi } from "@/lib/abi/roll";
import { EXPLORER_URL } from "@/lib/chain";
import { PYTH_ADDRESS, ROLL_ADDRESS, isLive } from "@/lib/contracts";
import { fmtCountdown, fmtEth, fmtMultiple, fmtPrice } from "@/lib/format";
import type { TableView } from "@/lib/hooks";
import { BELOW, cellBounds, LOCK, MIN_STAKE_WEI, quote as quoteRoll, type Layout } from "@/lib/layout";
import { explain, fetchUpdate } from "@/lib/tx";
import type { Selection } from "./Ladder";

const QUICK = ["0.005", "0.01", "0.05", "0.1"];

export function Ticket({
  asset,
  symbol,
  expiry,
  now,
  tableId,
  table,
  weights,
  layout,
  selection,
  onClear,
  stake,
  onStake,
  rakeBps,
  onDone,
}: {
  asset: number;
  symbol: string;
  expiry: number;
  now: number;
  tableId: bigint;
  table?: TableView;
  weights: readonly bigint[];
  layout?: Layout;
  selection: Selection | null;
  onClear: () => void;
  stake: string;
  onStake: (v: string) => void;
  rakeBps: number;
  onDone: () => void;
}) {
  const { address, isConnected } = useAccount();
  const balance = useBalance({ address, query: { enabled: Boolean(address), refetchInterval: 10_000 } });
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<"idle" | "update" | "wallet" | "mining">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  let stakeWei = 0n;
  try {
    stakeWei = stake.trim() ? parseEther(stake.trim()) : 0n;
  } catch {
    stakeWei = 0n;
  }
  const closesIn = expiry - LOCK - now;
  const closed = closesIn <= 0;
  const pot = (table?.pot ?? 0n) + (table?.carry ?? 0n);
  const q = selection && layout ? quoteRoll(stakeWei, selection.lo, selection.hi, weights, table?.pot ?? 0n, table?.carry ?? 0n, rakeBps) : undefined;
  const width = selection ? selection.hi - selection.lo + 1 : 0;

  const describe = (): { title: string; detail: string } | null => {
    if (!selection || !layout) return null;
    const above = layout.cells - 1;
    if (width === 1) {
      const c = selection.lo;
      if (c === BELOW) return { title: "Green · below", detail: `lands if the print is under ${fmtPrice(cellBounds(layout, 1).lower)}` };
      if (c === above) return { title: "Green · above", detail: `lands if the print is ${fmtPrice(cellBounds(layout, above - 1).upper)} or more` };
      const b = cellBounds(layout, c);
      return { title: `Straight-up · ${fmtPrice(b.lower + layout.tick / 2n)}`, detail: `lands if the print is at least ${fmtPrice(b.lower)} and under ${fmtPrice(b.upper)}` };
    }
    const lo = selection.lo === BELOW ? "below" : fmtPrice(cellBounds(layout, selection.lo).lower + layout.tick / 2n);
    const hi = selection.hi === above ? "above" : fmtPrice(cellBounds(layout, selection.hi).lower + layout.tick / 2n);
    return { title: `Zone · ${lo} → ${hi}`, detail: `${width} cells, ${fmtEth(stakeWei / BigInt(width))} on each` };
  };
  const desc = describe();

  const canRoll = isLive && isConnected && Boolean(selection) && stakeWei >= MIN_STAKE_WEI && !closed && busy === "idle" && Boolean(ROLL_ADDRESS);

  const roll = async () => {
    if (!selection || !ROLL_ADDRESS || !publicClient) return;
    setError(null);
    setHash(null);
    try {
      let tx: `0x${string}`;
      if (tableId > 0n) {
        setBusy("wallet");
        tx = await writeContractAsync({ address: ROLL_ADDRESS, abi: rollAbi, functionName: "roll", args: [tableId, selection.lo, selection.hi], value: stakeWei });
      } else {
        setBusy("update");
        const upd = await fetchUpdate(symbol);
        const fee = await publicClient.readContract({ address: PYTH_ADDRESS, abi: pythAbi, functionName: "getUpdateFee", args: [upd.data] });
        setBusy("wallet");
        tx = await writeContractAsync({
          address: ROLL_ADDRESS,
          abi: rollAbi,
          functionName: "openAndRoll",
          args: [asset, BigInt(expiry), upd.data, selection.lo, selection.hi],
          value: stakeWei + fee,
        });
      }
      setHash(tx);
      setBusy("mining");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      onDone();
      onClear();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="display text-xl">Your roll</h2>
        {selection ? (
          <button type="button" className="text-sm text-ash hover:text-bone" onClick={onClear}>
            clear
          </button>
        ) : null}
      </div>

      {desc ? (
        <div className="mt-4">
          <div className="num text-[15px] text-bone">{desc.title}</div>
          <div className="mt-1 text-sm text-ash">{desc.detail}</div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ash">Click a number for a straight-up. Click a second one — or drag — for a zone between them.</p>
      )}

      <label className="mt-5 block text-sm text-ash" htmlFor="stake">
        Stake
      </label>
      <div className="relative mt-1.5">
        <input
          id="stake"
          className="field pr-14"
          inputMode="decimal"
          placeholder="0.01"
          value={stake}
          onChange={(e) => onStake(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <span className="num pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-smoke">ETH</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK.map((v) => (
          <button key={v} type="button" className={`chip hover:border-chrome hover:text-bone ${stake === v ? "border-chrome text-bone" : ""}`} onClick={() => onStake(v)}>
            {v}
          </button>
        ))}
        {balance.data ? <span className="chip ml-auto">balance {fmtEth(balance.data.value, 4)}</span> : null}
      </div>

      <dl className="num mt-5 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
        <dt className="text-ash">pot as it stands</dt>
        <dd className="text-right text-bone">{fmtEth(pot)}</dd>
        {table && table.carry > 0n ? (
          <>
            <dt className="text-ash">of which rolled in</dt>
            <dd className="text-right text-red">{fmtEth(table.carry)}</dd>
          </>
        ) : null}
        <dt className="text-ash">rake on a settled pot</dt>
        <dd className="text-right text-bone">{(rakeBps / 100).toFixed(1)} %</dd>
        {q && selection ? (
          <>
            <dt className="mt-2 border-t border-line pt-2 text-bone">if it lands, you take</dt>
            <dd className="mt-2 border-t border-line pt-2 text-right text-bone">
              {width === 1 ? (
                <>
                  {fmtEth(q.payouts[0].payout)} <span className="text-red">{fmtMultiple(q.payouts[0].multiple)}</span>
                </>
              ) : (
                <>
                  <span className="text-red">{fmtMultiple(q.min)}</span> – <span className="text-red">{fmtMultiple(q.max)}</span>
                </>
              )}
            </dd>
          </>
        ) : null}
      </dl>
      {q && selection ? <p className="mt-2 text-xs text-smoke">Quoted on the pot right now, with your roll in it. Every roll after yours moves it.</p> : null}

      <div className="mt-5">
        {!isLive ? (
          <button type="button" className="btn btn-line w-full" disabled>
            Tables open at launch
          </button>
        ) : !isConnected ? (
          <ConnectButton size="md" />
        ) : closed ? (
          <button type="button" className="btn btn-line w-full" disabled>
            Closed · settles at 16:00 UTC
          </button>
        ) : (
          <button type="button" className="btn btn-red w-full" disabled={!canRoll} onClick={roll}>
            {busy === "update"
              ? "Fetching the Pyth print…"
              : busy === "wallet"
                ? "Confirm in your wallet…"
                : busy === "mining"
                  ? "Rolling…"
                  : !selection
                    ? "Pick a price first"
                    : stakeWei < MIN_STAKE_WEI
                      ? "Stake at least 0.001 ETH"
                      : tableId > 0n
                        ? `Roll ${fmtEth(stakeWei)}`
                        : `Open the table & roll ${fmtEth(stakeWei)}`}
          </button>
        )}
        {isLive && !closed ? (
          <p className="mt-2 text-center text-xs text-smoke">
            {tableId > 0n ? "" : "You would open this table: the current Pyth print centres its layout. "}
            Closes in {fmtCountdown(closesIn)}.
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red">{error}</p> : null}
        {hash ? (
          <p className="num mt-3 text-xs text-ash">
            tx{" "}
            <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:text-bone">
              {hash.slice(0, 10)}…
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

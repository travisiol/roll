"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBlock, useReadContract, useReadContracts } from "wagmi";
import { rollAbi } from "./abi/roll";
import type { PricesResponse } from "@/app/api/prices/route";
import { ROLL_ADDRESS, isLive } from "./contracts";

export type TableView = {
  asset: number;
  status: number; // 0 open, 1 settled, 2 void
  cells: number;
  winningCell: number;
  expiry: bigint;
  openedAt: bigint;
  anchor: bigint;
  tick: bigint;
  settlePrice: bigint;
  pot: bigint;
  carry: bigint;
  payoutPool: bigint;
};

export type RollView = {
  id: bigint;
  tableId: bigint;
  owner: `0x${string}`;
  lo: number;
  hi: number;
  claimed: boolean;
  stake: bigint;
  owed: bigint;
};

const contract = { address: ROLL_ADDRESS, abi: rollAbi } as const;

/**
 * Seconds, ticking, aligned on the chain's clock: the offset between the
 * latest block's timestamp and the wall clock is re-read every few seconds.
 * On Robinhood Chain that offset is a second or two; on a local node it is
 * whatever the seed script warped.
 */
export function useChainNow(): number {
  const { data: block } = useBlock({ watch: true, query: { refetchInterval: 6_000, enabled: true } });
  const offset = useRef(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (block?.timestamp !== undefined) {
      const wall = Date.now() / 1000;
      const chain = Number(block.timestamp);
      // never let a stale block pull the clock backwards below its own stamp
      offset.current = Math.max(chain - wall, offset.current > chain - wall - 30 ? offset.current : chain - wall);
      setNow(Math.floor(wall + offset.current));
    }
  }, [block?.timestamp]);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000 + offset.current)), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function usePrices() {
  return useQuery<PricesResponse>({
    queryKey: ["prices"],
    queryFn: async () => {
      const res = await fetch("/api/prices", { cache: "no-store" });
      if (!res.ok) throw new Error(`prices ${res.status}`);
      return (await res.json()) as PricesResponse;
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}

/** The table (asset, expiry) if it exists, with its cell weights. */
export function useTable(asset: number, expiry: number) {
  const idQuery = useReadContract({
    ...contract,
    functionName: "tableOf",
    args: [asset, BigInt(expiry)],
    query: { enabled: isLive, refetchInterval: 6_000 },
  });
  const id = idQuery.data ?? 0n;
  const detail = useReadContracts({
    contracts: [
      { ...contract, functionName: "getTable", args: [id] },
      { ...contract, functionName: "getCellWeights", args: [id] },
    ],
    query: { enabled: isLive && id > 0n, refetchInterval: 6_000 },
  });
  const table = detail.data?.[0]?.result as TableView | undefined;
  const weights = (detail.data?.[1]?.result as readonly bigint[] | undefined) ?? [];
  return {
    id,
    table: id > 0n ? table : undefined,
    weights,
    isLoading: idQuery.isLoading || (id > 0n && detail.isLoading),
    refetch: () => {
      void idQuery.refetch();
      void detail.refetch();
    },
  };
}

export function useTableById(id: bigint | undefined) {
  const q = useReadContracts({
    contracts: [
      { ...contract, functionName: "getTable", args: [id ?? 0n] },
      { ...contract, functionName: "getCellWeights", args: [id ?? 0n] },
    ],
    query: { enabled: isLive && id !== undefined && id > 0n, refetchInterval: 8_000 },
  });
  return {
    table: q.data?.[0]?.result as TableView | undefined,
    weights: (q.data?.[1]?.result as readonly bigint[] | undefined) ?? [],
    isLoading: q.isLoading,
  };
}

/** Every roll the connected wallet ever made, newest first, with what it is owed. */
export function useMyRolls() {
  const { address } = useAccount();
  const ids = useReadContract({
    ...contract,
    functionName: "rollsOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: isLive && Boolean(address), refetchInterval: 6_000 },
  });
  const list = useMemo(() => [...(ids.data ?? [])].reverse(), [ids.data]);
  const detail = useReadContracts({
    contracts: list.flatMap((id) => [
      { ...contract, functionName: "getRoll", args: [id] },
      { ...contract, functionName: "owed", args: [id] },
    ]),
    query: { enabled: isLive && list.length > 0, refetchInterval: 6_000 },
  });
  const rolls: RollView[] = useMemo(() => {
    if (!detail.data) return [];
    return list.map((id, i) => {
      const r = detail.data[i * 2]?.result as Omit<RollView, "id" | "owed"> | undefined;
      const owed = (detail.data[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
      return { id, tableId: r?.tableId ?? 0n, owner: r?.owner ?? "0x", lo: r?.lo ?? 0, hi: r?.hi ?? 0, claimed: r?.claimed ?? false, stake: r?.stake ?? 0n, owed };
    });
  }, [detail.data, list]);
  const tableIds = useMemo(() => [...new Set(rolls.map((r) => r.tableId.toString()))].map((s) => BigInt(s)), [rolls]);
  const tables = useReadContracts({
    contracts: tableIds.map((id) => ({ ...contract, functionName: "getTable", args: [id] })),
    query: { enabled: isLive && tableIds.length > 0, refetchInterval: 8_000 },
  });
  const tableById = useMemo(() => {
    const m = new Map<string, TableView>();
    tableIds.forEach((id, i) => {
      const t = tables.data?.[i]?.result as TableView | undefined;
      if (t) m.set(id.toString(), t);
    });
    return m;
  }, [tableIds, tables.data]);
  return {
    rolls,
    tableById,
    isLoading: ids.isLoading || detail.isLoading,
    refetch: () => {
      void ids.refetch();
      void detail.refetch();
      void tables.refetch();
    },
  };
}

export function useRakeBps(): number {
  const q = useReadContract({ ...contract, functionName: "rakeBps", query: { enabled: isLive, staleTime: Infinity } });
  return q.data ?? 270;
}

export type RecentTable = { expiry: number; id: bigint; table?: TableView };

/** The asset's tables for the `count` expiries before `expiry`, newest first. */
export function useRecentTables(asset: number, expiry: number, count = 7): { tables: RecentTable[]; refetch: () => void } {
  const expiries = useMemo(() => Array.from({ length: count }, (_, k) => expiry - (k + 1) * 86_400), [expiry, count]);
  const ids = useReadContracts({
    contracts: expiries.map((e) => ({ ...contract, functionName: "tableOf", args: [asset, BigInt(e)] })),
    query: { enabled: isLive, refetchInterval: 10_000 },
  });
  const found = useMemo(
    () => expiries.map((e, i) => ({ expiry: e, id: (ids.data?.[i]?.result as bigint | undefined) ?? 0n })).filter((x) => x.id > 0n),
    [expiries, ids.data],
  );
  const tables = useReadContracts({
    contracts: found.map((f) => ({ ...contract, functionName: "getTable", args: [f.id] })),
    query: { enabled: isLive && found.length > 0, refetchInterval: 10_000 },
  });
  const result = useMemo(() => found.map((f, i) => ({ ...f, table: tables.data?.[i]?.result as TableView | undefined })), [found, tables.data]);
  return {
    tables: result,
    refetch: () => {
      void ids.refetch();
      void tables.refetch();
    },
  };
}

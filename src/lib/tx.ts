import { BaseError, ContractFunctionRevertedError } from "viem";
import type { UpdateResponse } from "@/app/api/pyth/update/route";

/** Pyth update data from the site's Hermes proxy (or the local mock). */
export async function fetchUpdate(symbol: string, at?: number): Promise<UpdateResponse> {
  const qs = new URLSearchParams({ asset: symbol });
  if (at !== undefined) qs.set("at", String(at));
  const res = await fetch(`/api/pyth/update?${qs}`, { cache: "no-store" });
  const body = (await res.json()) as UpdateResponse & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `update ${res.status}`);
  return body;
}

const REASONS: Record<string, string> = {
  Locked: "Rolls are closed on this table — it settles at 16:00 UTC.",
  StakeTooSmall: "The minimum stake is 0.001 ETH.",
  TooEarly: "Too early: this table cannot be opened or settled yet.",
  TooLate: "Too late: that expiry is already locked.",
  TableExists: "Someone opened this table a moment ago — roll again.",
  FeeNotCovered: "The transaction did not cover the Pyth fee.",
  NotOpen: "This table is no longer open.",
  NotSettled: "This table has not settled yet.",
  NotAWinner: "That roll did not land.",
  AlreadyClaimed: "Already paid out.",
  BadCells: "That selection is not on the layout.",
  PriceFeedNotFoundWithinRange: "Pyth had no print for that window — the update was not the first one after expiry.",
  StalePrice: "The price update was too old for an anchor. Try again.",
  InsufficientFee: "The Pyth fee was not covered.",
};

/** A sentence for the ticket instead of a stack of hex. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason;
      if (name && REASONS[name]) return REASONS[name];
      if (name) return `Reverted: ${name}`;
    }
    if (/user rejected|denied/i.test(e.shortMessage)) return "You dismissed the wallet prompt.";
    if (/insufficient funds/i.test(e.shortMessage)) return "Not enough ETH for the stake and gas.";
    return e.shortMessage;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

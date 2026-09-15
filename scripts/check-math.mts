/**
 * Pins src/lib/layout.ts to the contract: the same cases the Hardhat tests
 * assert against Roll.sol, computed here in TypeScript. If this drifts, the
 * site quotes a different number from the one the chain pays.
 *
 *   npm run check:math
 */
import assert from "node:assert/strict";
import { cellBounds, cellOf, currentExpiry, layoutFor, quote, usd } from "../src/lib/layout.ts";

const DAY = 86_400;
const HOUR = 3_600;

// layout rounding — same table as contracts/test/Roll.test.ts
const btc = layoutFor(usd(79_720.01), 35, 19);
assert.equal(btc.tick, usd(200));
assert.equal(btc.anchor, usd(79_800));
assert.equal(btc.cells, 41);
const ticks: [number, number, number][] = [
  [2_455.73, 35, 10],
  [182.34, 50, 1],
  [412.5, 50, 2],
  [96.3, 70, 0.5],
  [322, 70, 2],
  [120_000, 35, 500],
  [45_000, 35, 200],
  [40_000, 35, 100],
];
for (const [price, bps, expected] of ticks) assert.equal(layoutFor(usd(price), bps, 19).tick, usd(expected), `tick at ${price}`);

// bounds and the cell a print lands in
assert.deepEqual(cellBounds(btc, 1), { lower: usd(79_800 - 19 * 200 - 100), upper: usd(79_800 - 19 * 200 + 100) });
assert.deepEqual(cellBounds(btc, 20), { lower: usd(79_700), upper: usd(79_900) });
assert.equal(cellOf(btc, usd(79_812)), 20);
assert.equal(cellOf(btc, usd(79_900)), 21); // boundary belongs to the upper number
assert.equal(cellOf(btc, usd(83_700)), 40); // ABOVE
assert.equal(cellOf(btc, usd(83_699.99)), 39);
assert.equal(cellOf(btc, usd(75_899.99)), 0); // BELOW: number 1 starts at 75,900
assert.equal(cellOf(btc, usd(75_900)), 1);

// schedule
const day = 1_789_430_400; // 2026-09-15 00:00 UTC
assert.equal(currentExpiry(day + 10 * HOUR), day + 16 * HOUR);
assert.equal(currentExpiry(day + 15 * HOUR - 1), day + 16 * HOUR);
assert.equal(currentExpiry(day + 15 * HOUR), day + DAY + 16 * HOUR);

// payout quote — the settlement test: alice 0.01 on 20, bob 0.05 on 18-22, carol 0.02 on 5
const eth = (x: string) => BigInt(Math.round(Number(x) * 1e6)) * 10n ** 12n;
const weights = new Array<bigint>(41).fill(0n);
weights[20] = eth("0.01") + eth("0.01");
for (const c of [18, 19, 21, 22]) weights[c] = eth("0.01");
weights[5] = eth("0.02");
const pot = eth("0.08");
// quote bob's zone as if he were adding it now: pot before him = 0.03, weights without him
const before = weights.map((w, c) => (c >= 18 && c <= 22 ? w - eth("0.01") : w));
const q = quote(eth("0.05"), 18, 22, before, pot - eth("0.05"), 0n, 270);
const total = pot;
const pool = total - (total * 270n) / 10_000n;
assert.equal(q.payouts.find((p) => p.cell === 20)!.payout, pool / 2n); // half the cell with alice
assert.equal(q.payouts.find((p) => p.cell === 18)!.payout, pool); // alone on 18
assert.equal(q.weightPerCell, eth("0.01"));

console.log("layout math matches the contract: layouts, bounds, cells, schedule, quotes");

/**
 * The table's arithmetic, mirrored from contracts/contracts/Roll.sol so the
 * site can draw a layout before a table exists and quote a roll before it is
 * sent. Prices are bigints in 1e-8 USD, exactly as on chain.
 * scripts/check-math.mts pins this file to the contract's own numbers.
 */
export const PRICE_UNIT = 100_000_000n;

export const LOCK = 3_600;
export const HORIZON = 25 * 3_600;
export const SETTLE_WINDOW = 15 * 60;
export const VOID_AFTER = 3 * 86_400;
export const CADENCE = 86_400;
export const PHASE = 16 * 3_600;
export const MIN_STAKE_WEI = 1_000_000_000_000_000n; // 0.001 ETH

export const BELOW = 0;

export type Layout = { anchor: bigint; tick: bigint; cells: number };

/** $ → 1e-8 units. */
export function usd(x: number): bigint {
  return BigInt(Math.round(x * 1e8));
}

/** 1e-8 units → $. */
export function toUsd(x: bigint): number {
  return Number(x) / 1e8;
}

/** Nearest 1 / 2 / 5 × 10^k (log-nearest) of `target` (1e-8 units). */
export function niceTick(target: bigint): bigint {
  if (target <= 0n) target = 1n;
  let pow = 1n;
  while (pow * 10n <= target) pow *= 10n;
  const sq = target * target;
  const p2 = pow * pow;
  if (sq < 2n * p2) return pow;
  if (sq < 10n * p2) return 2n * pow;
  if (sq < 50n * p2) return 5n * pow;
  return 10n * pow;
}

/** The layout a table opened at `price` gets. Same rounding as Roll._layout. */
export function layoutFor(price: bigint, tickBps: number, halfWidth: number): Layout {
  const tick = niceTick((price * BigInt(tickBps)) / 10_000n);
  const half = tick / 2n;
  const anchor = ((price + half) / tick) * tick;
  return { anchor, tick, cells: halfWidth * 2 + 3 };
}

export function halfWidthOf(cells: number): number {
  return (cells - 2) >> 1;
}

export function isGreen(layout: Layout, cell: number): boolean {
  return cell === BELOW || cell === layout.cells - 1;
}

/** Centre price of a numbered cell. */
export function cellCentre(layout: Layout, cell: number): bigint {
  const half = BigInt(halfWidthOf(layout.cells));
  return layout.anchor + (BigInt(cell) - 1n - half) * layout.tick;
}

/** [lower, upper) of a numbered cell; greens are open-ended. */
export function cellBounds(layout: Layout, cell: number): { lower: bigint; upper: bigint } {
  const centre = cellCentre(layout, cell);
  return { lower: centre - layout.tick / 2n, upper: centre + layout.tick / 2n };
}

/** The cell a settlement price lands in. Same as Roll._cellOf. */
export function cellOf(layout: Layout, price: bigint): number {
  const half = BigInt(halfWidthOf(layout.cells));
  const lowEdge = layout.anchor - half * layout.tick - layout.tick / 2n;
  if (price < lowEdge) return BELOW;
  const numbers = BigInt(layout.cells - 2);
  const offset = (price - lowEdge) / layout.tick;
  if (offset >= numbers) return layout.cells - 1;
  return Number(offset) + 1;
}

/** Number 1..N of a cell, or the green's name. */
export function cellLabel(layout: Layout, cell: number): string {
  if (cell === BELOW) return "below";
  if (cell === layout.cells - 1) return "above";
  return String(cell);
}

// ------------------------------------------------------------- schedule

/** Next expiry whose rolls are still open at `at` (seconds). */
export function currentExpiry(at: number): number {
  let e = Math.floor((at + LOCK) / CADENCE) * CADENCE + PHASE;
  while (e <= at + LOCK) e += CADENCE;
  return e;
}

export function isScheduled(expiry: number): boolean {
  return expiry % CADENCE === PHASE;
}

export function canOpen(expiry: number, at: number): boolean {
  return isScheduled(expiry) && expiry > at + LOCK && expiry <= at + HORIZON;
}

// -------------------------------------------------------------- payouts

export type Quote = {
  /** Weight the roll puts on each covered cell. */
  weightPerCell: bigint;
  /** Payout if the price lands on `cell`, per covered cell, in wei. */
  payouts: { cell: number; payout: bigint; multiple: number }[];
  min: number;
  max: number;
};

/**
 * What a roll of `stake` on lo..hi would take home on each of its cells if
 * the table settled right now with the pot as it stands. Same integer
 * arithmetic as Roll.settle + Roll._share, with this roll added in.
 */
export function quote(
  stake: bigint,
  lo: number,
  hi: number,
  weights: readonly bigint[],
  pot: bigint,
  carry: bigint,
  rakeBps: number,
): Quote {
  const width = BigInt(hi - lo + 1);
  const weightPerCell = stake / width;
  const total = pot + carry + stake;
  const pool = total - (total * BigInt(rakeBps)) / 10_000n;
  const payouts: Quote["payouts"] = [];
  let min = Infinity;
  let max = 0;
  for (let c = lo; c <= hi; c++) {
    const w = (weights[c] ?? 0n) + weightPerCell;
    const payout = w === 0n ? 0n : (pool * weightPerCell) / w;
    const multiple = stake === 0n ? 0 : Number((payout * 10_000n) / stake) / 10_000;
    payouts.push({ cell: c, payout, multiple });
    if (multiple < min) min = multiple;
    if (multiple > max) max = multiple;
  }
  if (!isFinite(min)) min = 0;
  return { weightPerCell, payouts, min, max };
}

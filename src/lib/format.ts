import { formatEther } from "viem";
import { toUsd } from "./layout";

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * Dollar price with as few decimals as represent it exactly (up to two):
 * $79,800 · $2,460 · $182.50 · $96.25. A cell label and its bounds therefore
 * never round onto each other.
 */
export function fmtPrice(units: bigint): string {
  const v = toUsd(units);
  const decimals = units % 100_000_000n === 0n ? 0 : units % 10_000_000n === 0n ? 1 : 2;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Live prices (floats) — two decimals under $1,000, none above. */
export function fmtUsd(v: number): string {
  const decimals = v >= 1000 ? 0 : 2;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtEth(wei: bigint, digits = 4): string {
  const v = Number(formatEther(wei));
  if (v === 0) return "0 ETH";
  if (v < 0.0001) return "<0.0001 ETH";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} ETH`;
}

export function fmtMultiple(x: number): string {
  if (!isFinite(x) || x <= 0) return "—";
  if (x >= 100) return `×${Math.round(x)}`;
  if (x >= 10) return `×${x.toFixed(1)}`;
  return `×${x.toFixed(2)}`;
}

/** "Tue 16 Sep · 16:00 UTC" */
export function fmtExpiry(ts: number): string {
  const d = new Date(ts * 1000);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${day} · ${time} UTC`;
}

export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "4h 12m" / "38m" / "12s" — or "" when the moment has passed. */
export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

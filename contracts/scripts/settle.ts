import * as fs from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import { ASSETS } from "../../src/lib/catalog";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";

/**
 * Keeper for a deployed Roll: settles every table whose expiry has passed
 * with the Hermes benchmark update for that exact second, and — with
 * OPEN=1 — opens the current table of every asset that has none.
 *
 *   PYTH_API_KEY=… npm run settle:robinhood
 *
 * Anyone can run it (the contract has no operator); the site's Settle
 * button does the same through its own Hermes proxy.
 */
const HERMES = (process.env.HERMES_URL ?? "https://hermes.pyth.network").replace(/\/$/, "");
const DAY = 86_400;
const HOUR = 3_600;
const PHASE = 16 * HOUR;
const LOCK = HOUR;

function nextExpiry(at: number): number {
  let e = Math.floor((at + LOCK) / DAY) * DAY + PHASE;
  while (e <= at + LOCK) e += DAY;
  return e;
}

async function hermes(pathname: string, feedId: string): Promise<string[]> {
  const key = process.env.PYTH_API_KEY?.trim();
  if (!key) throw new Error("PYTH_API_KEY is required (Hermes needs a key since 2026-08-26)");
  const url = `${HERMES}${pathname}?ids[]=${feedId.replace(/^0x/, "")}&encoding=hex`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Hermes ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { binary: { data: string[] } };
  return body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`));
}

async function main() {
  const file = path.join(deploymentsDir, `${network.name}.json`);
  const record = JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentRecord;
  const roll = await ethers.getContractAt("Roll", record.roll);
  const pyth = await ethers.getContractAt("IPyth", record.pyth);
  const now = Number((await ethers.provider.getBlock("latest"))!.timestamp);
  const current = nextExpiry(now);

  for (let i = 0; i < ASSETS.length; i++) {
    const a = ASSETS[i];
    // settle everything due in the last 3 days
    for (let e = current - DAY; e >= current - 4 * DAY; e -= DAY) {
      const id = await roll.tableOf(i, e);
      if (id === 0n) continue;
      const t = await roll.getTable(id);
      if (Number(t.status) !== 0 || now < e) continue;
      const data = await hermes(`/v2/updates/price/${e}`, a.feedId);
      const fee = await pyth.getUpdateFee(data);
      const tx = await roll.settle(id, data, { value: fee });
      console.log(`${a.symbol} table ${id} (expiry ${new Date(e * 1000).toISOString()}) settle tx ${tx.hash}`);
      await tx.wait();
      const after = await roll.getTable(id);
      console.log(`  → price ${Number(after.settlePrice) / 1e8}, cell ${after.winningCell}, pool ${ethers.formatEther(after.payoutPool)} ETH`);
    }
    if (process.env.OPEN === "1" && (await roll.tableOf(i, current)) === 0n) {
      const data = await hermes("/v2/updates/price/latest", a.feedId);
      const fee = await pyth.getUpdateFee(data);
      const tx = await roll.open(i, current, data, { value: fee });
      console.log(`${a.symbol} open table for ${new Date(current * 1000).toISOString()} tx ${tx.hash}`);
      await tx.wait();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

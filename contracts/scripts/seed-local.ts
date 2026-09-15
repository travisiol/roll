import * as fs from "fs";
import * as path from "path";
import { AbiCoder, parseEther } from "ethers";
import { ethers, network } from "hardhat";
import { ASSETS, assetTuples } from "../../src/lib/catalog";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";
import multicall3 from "./lib/multicall3.json";

/**
 * Seeds a local node (`npm run node`, port 8560) with a playable ROLL:
 * MockPyth + Roll, one settled round per asset (one of them with nobody on
 * the number, so a carry rolls forward), then the next round opened with a
 * lively spread of rolls from the node's accounts. Writes
 * deployments/local.json; point the site at it with the .env.local the
 * script prints.
 *
 * The chain clock ends up a few hours ahead of the wall clock; the site
 * reads block time, so countdowns stay right.
 */
const DAY = 86_400;
const HOUR = 3_600;
const PHASE = 16 * HOUR;
const LOCK = HOUR;
const coder = AbiCoder.defaultAbiCoder();

/** Local demo prices, USD. */
const PRICES: Record<string, number> = { BTC: 79_720.01, ETH: 2_455.73, NVDA: 182.34, TSLA: 412.5, HOOD: 96.3, MSTR: 322.1 };

const usd = (x: number) => BigInt(Math.round(x * 1e8));

function encodeUpdate(feedId: string, price: bigint, publishTime: number, prevPublishTime: number): string {
  return coder.encode(["bytes32", "int64", "uint64", "int32", "uint64", "uint64"], [feedId, price, 0n, -8, publishTime, prevPublishTime]);
}

function nextExpiry(at: number): number {
  let e = Math.floor((at + LOCK) / DAY) * DAY + PHASE;
  while (e <= at + LOCK) e += DAY;
  return e;
}

async function chainNow(): Promise<number> {
  const b = await ethers.provider.getBlock("latest");
  return Number(b!.timestamp);
}

async function warpTo(ts: number) {
  const now = await chainNow();
  if (ts <= now) return;
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") throw new Error("seed-local is for the local node only");
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  const players = signers.slice(1, 9);

  // Multicall3 at its canonical address, as on Robinhood Chain: wagmi batches
  // every read through it and would get empty answers without it.
  await network.provider.send("hardhat_setCode", [multicall3.address, multicall3.code]);

  const mock = await (await ethers.getContractFactory("MockPyth")).deploy(0);
  await mock.waitForDeployment();
  const roll = await (await ethers.getContractFactory("Roll")).deploy(await mock.getAddress(), deployer.address, 270, assetTuples());
  await roll.waitForDeployment();
  const rollAddress = await roll.getAddress();
  console.log(`MockPyth ${await mock.getAddress()}  Roll ${rollAddress}`);

  const fresh = async (i: number, price: number) => {
    const now = await chainNow();
    return [encodeUpdate(ASSETS[i].feedId, usd(price), now, now - 1)];
  };

  // ---- round 1: open, roll, settle
  const now0 = await chainNow();
  const e1 = nextExpiry(now0);
  console.log(`round 1 expiry ${new Date(e1 * 1000).toISOString()}`);
  const ids1: bigint[] = [];
  for (let i = 0; i < ASSETS.length; i++) {
    await (await roll.open(i, e1, await fresh(i, PRICES[ASSETS[i].symbol]))).wait();
    ids1.push(await roll.tableOf(i, e1));
  }
  // rolls: everybody around the middle, a few far out
  for (let i = 0; i < ASSETS.length; i++) {
    const id = ids1[i];
    await (await roll.connect(players[0]).roll(id, 20, 20, { value: parseEther("0.02") })).wait();
    await (await roll.connect(players[1]).roll(id, 18, 22, { value: parseEther("0.05") })).wait();
    await (await roll.connect(players[2]).roll(id, 24, 24, { value: parseEther("0.01") })).wait();
    await (await roll.connect(players[3]).roll(id, 9, 14, { value: parseEther("0.03") })).wait();
    if (i % 2 === 0) await (await roll.connect(players[4]).roll(id, 40, 40, { value: parseEther("0.004") })).wait();
  }
  await warpTo(e1 + 30);
  // settle: BTC lands on 21 (winners: the 18-22 zone), ETH on 20, NVDA on a
  // number nobody holds (carry), the rest on 20 or 24
  const settleAt: Record<string, number> = { BTC: 80_010, ETH: 2_461, NVDA: 179.2, TSLA: 412.7, HOOD: 96.9, MSTR: 325.4 };
  for (let i = 0; i < ASSETS.length; i++) {
    const p = usd(settleAt[ASSETS[i].symbol]);
    await (await roll.settle(ids1[i], [encodeUpdate(ASSETS[i].feedId, p, e1, e1 - 1)])).wait();
    const t = await roll.getTable(ids1[i]);
    console.log(`${ASSETS[i].symbol.padEnd(5)} table ${ids1[i]} settled at ${settleAt[ASSETS[i].symbol]} → cell ${t.winningCell}, pool ${ethers.formatEther(t.payoutPool)} ETH`);
  }
  // one winner claims (the 18-22 zone on BTC), the others stay pending so "claim" shows up
  try {
    await (await roll.claim(2)).wait();
  } catch {
    /* not a winner after all */
  }

  // ---- round 2: the live one
  const e2 = e1 + DAY;
  const drift: Record<string, number> = { BTC: 80_010, ETH: 2_461, NVDA: 179.2, TSLA: 412.7, HOOD: 96.9, MSTR: 325.4 };
  const ids2: bigint[] = [];
  for (let i = 0; i < ASSETS.length; i++) {
    await (await roll.open(i, e2, await fresh(i, drift[ASSETS[i].symbol]))).wait();
    ids2.push(await roll.tableOf(i, e2));
  }
  const spread: [number, number, number, string][] = [
    [0, 20, 20, "0.05"],
    [1, 21, 21, "0.02"],
    [2, 19, 23, "0.08"],
    [3, 17, 17, "0.01"],
    [4, 25, 28, "0.03"],
    [5, 20, 20, "0.01"],
    [6, 12, 12, "0.004"],
    [7, 30, 39, "0.02"],
    [0, 0, 0, "0.002"],
    [1, 40, 40, "0.003"],
    [2, 22, 22, "0.015"],
  ];
  for (let i = 0; i < ASSETS.length; i++) {
    for (const [p, lo, hi, v] of spread.slice(0, 5 + (i % 4) * 2)) {
      await (await roll.connect(players[p]).roll(ids2[i], lo, hi, { value: parseEther(v) })).wait();
    }
  }
  for (let i = 0; i < ASSETS.length; i++) {
    const t = await roll.getTable(ids2[i]);
    console.log(`${ASSETS[i].symbol.padEnd(5)} table ${ids2[i]} open, pot ${ethers.formatEther(t.pot)} ETH, carry ${ethers.formatEther(t.carry)} ETH, tick ${Number(t.tick) / 1e8}`);
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    roll: rollAddress,
    pyth: await mock.getAddress(),
    treasury: deployer.address,
    rakeBps: 270,
    assets: ASSETS.map((a) => a.symbol),
    deployedAt: new Date().toISOString(),
    txHash: null,
  };
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, "local.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(`\nchain time now ${new Date((await chainNow()) * 1000).toISOString()}`);
  console.log(`\n.env.local for the site:\nNEXT_PUBLIC_CHAIN_ID=${chainId}\nNEXT_PUBLIC_RPC_URL=http://127.0.0.1:8641\nNEXT_PUBLIC_ROLL_ADDRESS=${rollAddress}\nNEXT_PUBLIC_PYTH_ADDRESS=${await mock.getAddress()}\nNEXT_PUBLIC_PYTH_MOCK=1\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

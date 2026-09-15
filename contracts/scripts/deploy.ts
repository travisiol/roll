import * as fs from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import { ASSETS, assetTuples } from "../../src/lib/catalog";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";

/**
 * Deploys Roll.
 *
 *   npm run deploy:robinhood   — DEPLOYER_PRIVATE_KEY, TREASURY, RAKE_BPS and
 *                                PYTH_ADDRESS in contracts/.env
 *   npm run deploy:local       — against `npm run node` (port 8641); deploys a
 *                                MockPyth first when PYTH_ADDRESS is unset
 *
 * The record it writes (contracts/deployments/<network>.json) is what
 * next.config.ts reads to point the site at the contract.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY in contracts/.env");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const local = network.name === "hardhat" || network.name === "localhost";

  const rakeBps = Number(process.env.RAKE_BPS ?? 270);
  const treasury = process.env.TREASURY?.trim() || (local ? deployer.address : "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(treasury)) throw new Error("TREASURY must be an address (contracts/.env)");

  let pyth = process.env.PYTH_ADDRESS?.trim() ?? "";
  if (!pyth) {
    if (!local) throw new Error("PYTH_ADDRESS is required on a real network");
    const mock = await (await ethers.getContractFactory("MockPyth")).deploy(0);
    await mock.waitForDeployment();
    pyth = await mock.getAddress();
    console.log(`MockPyth at ${pyth}`);
  }
  if ((await ethers.provider.getCode(pyth)) === "0x") throw new Error(`no code at Pyth ${pyth} on chain ${chainId}`);

  console.log(`network ${network.name} chainId ${chainId} deployer ${deployer.address}`);
  console.log(`pyth ${pyth} treasury ${treasury} rake ${rakeBps} bps, ${ASSETS.length} assets`);

  const roll = await (await ethers.getContractFactory("Roll")).deploy(pyth, treasury, rakeBps, assetTuples());
  const tx = roll.deploymentTransaction();
  await roll.waitForDeployment();
  const address = await roll.getAddress();
  console.log(`Roll at ${address} (tx ${tx?.hash})`);

  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    roll: address,
    pyth,
    treasury,
    rakeBps,
    assets: ASSETS.map((a) => a.symbol),
    deployedAt: new Date().toISOString(),
    txHash: tx?.hash ?? null,
  };
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const file = path.join(deploymentsDir, `${local ? "local" : network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

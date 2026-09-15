import * as fs from "node:fs";
import * as path from "node:path";
import type { NextConfig } from "next";

/**
 * wagmi's Base Account connector dynamically imports `@base-org/account`,
 * whose Node build reaches for optional `@x402/*` payment packages that are
 * not installed and never executed here. The bundler still tries to resolve
 * them, so they are aliased away (webpack: false, Turbopack: src/lib/empty.cjs,
 * a CommonJS stub whose exports are not statically known).
 */
const OPTIONAL_MODULES = [
  "@x402/core",
  "@x402/core/client",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/svm",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/express",
  "@x402/extensions/bazaar",
  "@x402/fetch",
];

/**
 * The Roll address comes from NEXT_PUBLIC_ROLL_ADDRESS or, when that is
 * unset, from the record contracts/scripts/deploy.ts writes — so
 * `npm run deploy:robinhood` in contracts/ followed by `npm run build` here
 * is the whole hand-off. The record must be for the configured chain.
 */
function deployedRoll(): string | undefined {
  if (process.env.NEXT_PUBLIC_ROLL_ADDRESS?.trim()) return undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  const file = path.join(process.cwd(), "contracts", "deployments", chainId === 4663 ? "robinhood.json" : "local.json");
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as { chainId?: number; roll?: string };
    if (Number(record.chainId) === chainId && typeof record.roll === "string" && /^0x[0-9a-fA-F]{40}$/.test(record.roll)) return record.roll;
  } catch {
    /* no deployment record yet */
  }
  return undefined;
}

const roll = deployedRoll();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  env: roll ? { NEXT_PUBLIC_ROLL_ADDRESS: roll } : {},
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(OPTIONAL_MODULES.map((name) => [name, false])),
    };
    return config;
  },
  turbopack: {
    resolveAlias: Object.fromEntries(OPTIONAL_MODULES.map((name) => [name, "./src/lib/empty.cjs"])),
  },
};

export default nextConfig;

# ROLL

**Don't pick a side. Pick the price.**

Parimutuel price tables for BTC, ETH and tokenized stocks on Robinhood Chain,
settled by Pyth. One table per asset per day. You stake on the exact number
or on a zone of numbers; at 16:00 UTC the first Pyth print picks one cell
and everyone on it shares the pot. Nobody on it? The pot rolls to tomorrow.

Next 16 site at the root, Hardhat contracts in `contracts/`. Nothing is
deployed yet — see *Deploying*.

## The rules (all on chain, no owner)

| | |
| --- | --- |
| Assets | BTC, ETH, NVDA, TSLA, HOOD, MSTR — `src/lib/catalog.ts` (index = on-chain asset id) |
| Expiry | every day at **16:00 UTC** (`PHASE`); one table per asset per day |
| Layout | **39 numbers** one tick apart, centred on the price when the table opened, plus two greens: **BELOW** and **ABOVE** |
| Tick | nearest 1 / 2 / 5 × 10^k of a per-asset fraction of the price (35 bps crypto, 50–70 bps stocks) → $200 at BTC 79,720, $10 at ETH 2,456, $1 at NVDA 182 |
| A number | lands if the print is at least its lower bound and under its upper bound (one tick wide, centred on the number) |
| Opening | anyone, from 15:00 UTC the day before (`HORIZON` 25 h); the print they submit anchors the layout (≤ 120 s old) |
| Rolls | any contiguous run of cells, min **0.001 ETH**; the stake spreads **evenly over the cells** it covers; rolls close **one hour before** expiry (`LOCK`) |
| Settlement | anyone, with the Hermes benchmark update for the expiry second; Pyth's `parsePriceFeedUpdatesUnique` only accepts the **first print at or after expiry**, within 15 min |
| Payout | the pot (stakes + carry) minus the rake goes to the weight on the winning cell, pro rata; `claim()` pays the roll's owner, anyone may call it |
| Rake | **2.7 %** of a settled pot (`rakeBps`, fixed at deployment, ≤ 10 %), accrued for the treasury, `sweepRake()` by anyone |
| Rollover | winning cell empty → the whole pot, no rake, becomes the **carry** of the next table opened for that asset |
| Void | unsettled **3 days** after expiry → `voidTable()`: every roll refunded in full, the carry waits for the next table |

Prices are handled in 1e-8 USD whatever the feed's exponent. Stocks use
Pyth's 24/7 **Index** feeds (`Equity.Index.NVDA/USD`…), not the market-hours
ones, so a Saturday table settles like any other.

## Layout

```
contracts/
  contracts/Roll.sol            the whole game (open · roll · settle · claim · void · sweepRake)
  contracts/interfaces/IPyth.sol  the Pyth slice used (exact pyth-sdk signatures)
  contracts/mocks/MockPyth.sol  Pyth stand-in for tests and the local table
  test/Roll.test.ts             23 tests: schedule, tick rounding, bounds, split stakes,
                                settlement maths, greens, uniqueness rule, rollover, void, fees
  scripts/deploy.ts             deploy (local or Robinhood Chain) → deployments/<network>.json
  scripts/seed-local.ts         a playable local node: settled round + open round per asset
  scripts/settle.ts             keeper: settles due tables from Hermes (OPEN=1 also opens)
src/
  app/                          / (landing) · /table/[symbol] · /api/prices · /api/pyth/update · /api/dev/warp
  components/table/             Ladder (the layout) · Ticket (quote + roll) · Settle · MyRolls · History
  components/DiceHero.tsx       the glass dice (three.js, no assets — src/lib/three/dice.ts)
  lib/layout.ts                 the contract's arithmetic mirrored in TypeScript (scripts/check-math.mts pins it)
  lib/catalog.ts                assets + Pyth feed ids, shared with the deploy script
  lib/hermes.ts                 server-side Hermes client (the key never reaches the browser)
```

## Running it locally

```bash
npm install && npm --prefix contracts install
npm --prefix contracts run compile        # also exports the ABI to src/lib/abi
npm --prefix contracts test               # 23 passing
npm run check:math                        # TS mirror == Solidity
```

A playable table without any key:

```bash
npm --prefix contracts run node           # hardhat node on :8641
npm --prefix contracts run seed:local     # MockPyth + Roll + Multicall3, 6 settled + 6 open tables
```

Put what the seed prints into `.env.local` (chain 31337, RPC :8641, the two
addresses, `NEXT_PUBLIC_PYTH_MOCK=1`) and `npm run dev -- --port 3941`. Against
the mock, `/api/pyth/update` makes the prints up (settlement drifts a few
tenths of a percent from the stored price) and `POST /api/dev/warp {to}`
jumps the node's clock, so open → roll → settle → claim takes a minute.
`node scripts/capture.mjs` screenshots every screen with headless Chrome.

## Deploying

1. `contracts/.env`: `DEPLOYER_PRIVATE_KEY`, `TREASURY` (where the rake goes —
   fixed forever), `RAKE_BPS` (270), `PYTH_ADDRESS`
   (`0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a` on Robinhood Chain, verified
   2026-09-15: Pyth 1.4.5, `parsePriceFeedUpdatesUnique` present, fee 0).
2. `npm --prefix contracts run deploy:robinhood` → writes
   `contracts/deployments/robinhood.json`; `next.config.ts` reads it, so the
   site needs no address pasted anywhere.
3. Site env (Vercel — the repo imports from the root as-is):
   `PYTH_API_KEY` (**required** for live prices and for the browser's
   open/settle buttons: Hermes has needed a key since 2026-08-26, free trial
   at https://pythdata.app/signup), optional `HERMES_URL`,
   `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_SITE_URL`.
   Without the key the site shows the last print stored on chain and says so.
4. Optional keeper: `PYTH_API_KEY=… npm --prefix contracts run settle:robinhood`
   (add `OPEN=1` to also open the day's tables). Players can do both from
   the site; the keeper only makes sure nobody waits.

Until step 2 the site renders with dashes and "awaiting launch" — it never
invents a number.

## What has been verified

- 23 Hardhat tests on `Roll.sol`, including the exact payout of the
  settlement example (rake, split zone, pro-rata share) and the Pyth
  uniqueness rule against `MockPyth`.
- `scripts/check-math.mts`: the site's quotes use the same integers.
- The whole loop played in a browser against the seeded node with a stubbed
  wallet: connect → claim a landed roll (0.0714 ETH) → roll 0.01 ETH on
  $2,470 → warp to expiry → settle with the print → claim 0.137 ETH.
- `next build` (static landing + 6 SSG tables + 3 API routes), `eslint`,
  `tsc`, phone width without horizontal scroll.

Not verified: a real wallet, a real Hermes key, gas on Robinhood Chain.

## Open decisions

- **Treasury address** and the **rake** (2.7 % is a nod to the single-zero
  wheel; anything ≤ 10 % deploys). Both are constructor arguments: changing
  them later means a new contract.
- **The asset list** and the tick fractions — same, fixed at deployment.
- **Name.** `ROLL` is a placeholder (`src/lib/site.ts`); nothing else spells it.
- **Hermes key cost** once the trial ends: the site's proxy pays for every
  visitor's price polling (2.5 s server cache) and every open/settle.
- **Legal.** Real-money price betting is gambling or a derivative in most
  places; the FAQ says so, nothing geo-blocks anyone.
- **Audit.** None. The contract is 400 lines with no owner and no upgrade path.

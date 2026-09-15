import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { AbiCoder, parseEther, type Signer } from "ethers";
import type { MockPyth, Roll } from "../typechain-types";
import { ASSETS, assetTuples } from "../../src/lib/catalog";

const DAY = 86_400;
const HOUR = 3_600;
const PHASE = 16 * HOUR;
const LOCK = HOUR;
const RAKE_BPS = 270;
const coder = AbiCoder.defaultAbiCoder();

/** $ → 1e-8 units. */
const usd = (x: number) => BigInt(Math.round(x * 1e8));

function encodeUpdate(feedId: string, price: bigint, expo: number, publishTime: number, prevPublishTime: number): string {
  return coder.encode(["bytes32", "int64", "uint64", "int32", "uint64", "uint64"], [feedId, price, 0n, expo, publishTime, prevPublishTime]);
}

/** Next scheduled expiry strictly more than LOCK after `at`. */
function nextExpiry(at: number): number {
  let e = Math.floor((at + LOCK) / DAY) * DAY + PHASE;
  while (e <= at + LOCK) e += DAY;
  return e;
}

describe("Roll", () => {
  let roll: Roll;
  let pyth: MockPyth;
  let deployer: Signer, treasury: Signer, alice: Signer, bob: Signer, carol: Signer;
  let treasuryAddr: string;

  const BTC = 0;
  const ETH = 1;
  const NVDA = 2;

  /** A fresh Pyth update for `asset` at the current chain time. */
  async function freshUpdate(asset: number, price: number, expo = -8) {
    const now = await time.latest();
    const p = expo === -8 ? usd(price) : BigInt(Math.round(price * 10 ** -expo));
    return [encodeUpdate(ASSETS[asset].feedId, p, expo, now, now - 1)];
  }

  async function settleUpdate(asset: number, price: number, expiry: number, offset = 0, prevOffset = -1, expo = -8) {
    const p = expo === -8 ? usd(price) : BigInt(Math.round(price * 10 ** -expo));
    return [encodeUpdate(ASSETS[asset].feedId, p, expo, expiry + offset, expiry + prevOffset)];
  }

  async function openTable(asset: number, price: number, expiryOffsetDays = 0): Promise<{ id: bigint; expiry: number }> {
    const now = await time.latest();
    const expiry = nextExpiry(now) + expiryOffsetDays * DAY;
    await roll.open(asset, expiry, await freshUpdate(asset, price));
    const id = await roll.tableOf(asset, expiry);
    return { id, expiry };
  }

  beforeEach(async () => {
    [deployer, treasury, alice, bob, carol] = await ethers.getSigners();
    treasuryAddr = await treasury.getAddress();
    pyth = await (await ethers.getContractFactory("MockPyth")).deploy(0);
    roll = await (await ethers.getContractFactory("Roll")).deploy(await pyth.getAddress(), treasuryAddr, RAKE_BPS, assetTuples());
    // Start every test at 10:00 UTC on some day, well inside a table's window.
    const now = await time.latest();
    await time.increaseTo(Math.floor(now / DAY) * DAY + DAY + 10 * HOUR);
  });

  describe("schedule", () => {
    it("expires every day at 16:00 UTC and locks one hour before", async () => {
      const day = Math.floor((await time.latest()) / DAY) * DAY;
      expect(await roll.currentExpiry(day + 10 * HOUR)).to.equal(day + PHASE);
      // at 14:59:59 today's table is still open
      expect(await roll.currentExpiry(day + 15 * HOUR - 1)).to.equal(day + PHASE);
      // at 15:00:00 sharp it is locked: the current table is tomorrow's
      expect(await roll.currentExpiry(day + 15 * HOUR)).to.equal(day + DAY + PHASE);
      expect(await roll.isScheduled(day + PHASE)).to.equal(true);
      expect(await roll.isScheduled(day + PHASE + 1)).to.equal(false);
    });

    it("refuses tables off the schedule, beyond the horizon or already locked", async () => {
      const now = await time.latest();
      const expiry = nextExpiry(now);
      const upd = await freshUpdate(BTC, 79_720.01);
      await expect(roll.open(BTC, expiry + 1, upd)).to.be.revertedWithCustomError(roll, "OffSchedule");
      await expect(roll.open(BTC, expiry + 2 * DAY, upd)).to.be.revertedWithCustomError(roll, "TooEarly");
      await expect(roll.open(BTC, expiry - DAY, upd)).to.be.revertedWithCustomError(roll, "TooLate");
      await expect(roll.open(9, expiry, upd)).to.be.revertedWithCustomError(roll, "UnknownAsset");
      await roll.open(BTC, expiry, upd);
      await expect(roll.open(BTC, expiry, upd)).to.be.revertedWithCustomError(roll, "TableExists");
    });

    it("lets tomorrow's table open the minute today's locks", async () => {
      const now = await time.latest();
      const today = nextExpiry(now);
      const upd = await freshUpdate(ETH, 2_455.73);
      await expect(roll.open(ETH, today + DAY, upd)).to.be.revertedWithCustomError(roll, "TooEarly");
      await time.increaseTo(today - LOCK);
      await roll.open(ETH, today + DAY, await freshUpdate(ETH, 2_455.73));
      expect(await roll.tableOf(ETH, today + DAY)).to.equal(1n);
    });

    it("needs a fresh anchor print", async () => {
      const now = await time.latest();
      const expiry = nextExpiry(now);
      const stale = [encodeUpdate(ASSETS[BTC].feedId, usd(79_720), -8, now - 300, now - 301)];
      await expect(roll.open(BTC, expiry, stale)).to.be.revertedWithCustomError(pyth, "StalePrice");
    });
  });

  describe("layout", () => {
    it("rounds the tick to the nearest 1/2/5 step and the anchor to it", async () => {
      const { id } = await openTable(BTC, 79_720.01);
      const t = await roll.getTable(id);
      expect(t.tick).to.equal(usd(200)); // 0.35 % of 79,720 = $279 → $200
      expect(t.anchor).to.equal(usd(79_800));
      expect(t.cells).to.equal(41);
      expect(t.carry).to.equal(0n);
    });

    it("previews the same layout the table gets", async () => {
      const [anchor, tick, cells] = await roll.previewLayout(BTC, usd(79_720.01));
      expect(anchor).to.equal(usd(79_800));
      expect(tick).to.equal(usd(200));
      expect(cells).to.equal(41);
      const cases: [number, number, number][] = [
        [ETH, 2_455.73, 10], // $8.59 → $10
        [NVDA, 182.34, 1], // $0.91 → $1
        [3, 412.5, 2], // TSLA $2.06 → $2
        [4, 96.3, 0.5], // HOOD $0.67 → $0.50
        [5, 322, 2], // MSTR $2.25 → $2
        [BTC, 120_000, 500], // $420 → $500
        [BTC, 45_000, 200], // $157 → $200 (log-nearest: 1.57 > 1.41)
        [BTC, 40_000, 100], // $140 → $100 (1.40 < 1.41)
      ];
      for (const [asset, price, expected] of cases) {
        const [, tk] = await roll.previewLayout(asset, usd(price));
        expect(tk, `${ASSETS[asset].symbol} @ ${price}`).to.equal(usd(expected));
      }
    });

    it("exposes cell bounds: one tick wide, centred on the numbers, greens outside", async () => {
      const { id } = await openTable(BTC, 79_720.01);
      const [lo1, hi1] = await roll.cellBounds(id, 1);
      expect(lo1).to.equal(usd(79_800 - 19 * 200 - 100));
      expect(hi1).to.equal(usd(79_800 - 19 * 200 + 100));
      const [lo20, hi20] = await roll.cellBounds(id, 20);
      expect(lo20).to.equal(usd(79_700));
      expect(hi20).to.equal(usd(79_900));
      const [, hi39] = await roll.cellBounds(id, 39);
      expect(hi39).to.equal(usd(79_800 + 19 * 200 + 100));
      await expect(roll.cellBounds(id, 0)).to.be.revertedWithCustomError(roll, "BadCells");
      await expect(roll.cellBounds(id, 40)).to.be.revertedWithCustomError(roll, "BadCells");
    });

    it("normalises any Pyth exponent to 1e-8 units", async () => {
      const now = await time.latest();
      const expiry = nextExpiry(now);
      // an equity-style print with exponent -5
      const upd = [encodeUpdate(ASSETS[NVDA].feedId, 18_234_000n, -5, now, now - 1)];
      await roll.open(NVDA, expiry, upd);
      const t = await roll.getTable(1);
      expect(t.anchor).to.equal(usd(182));
      expect(t.tick).to.equal(usd(1));
    });
  });

  describe("rolling", () => {
    it("spreads the stake evenly over the cells it covers", async () => {
      const { id } = await openTable(BTC, 79_720.01);
      await roll.connect(alice).roll(id, 20, 20, { value: parseEther("0.01") });
      await roll.connect(bob).roll(id, 18, 22, { value: parseEther("0.05") });
      const w = await roll.getCellWeights(id);
      expect(w.length).to.equal(41);
      expect(w[20]).to.equal(parseEther("0.02"));
      expect(w[18]).to.equal(parseEther("0.01"));
      expect(w[22]).to.equal(parseEther("0.01"));
      expect(w[17]).to.equal(0n);
      expect((await roll.getTable(id)).pot).to.equal(parseEther("0.06"));
      const mine = await roll.rollsOf(await bob.getAddress());
      expect(mine.map(Number)).to.deep.equal([2]);
      const ticket = await roll.getRoll(2);
      expect(ticket.lo).to.equal(18);
      expect(ticket.hi).to.equal(22);
      expect(ticket.stake).to.equal(parseEther("0.05"));
    });

    it("keeps the division remainder in the pot", async () => {
      const { id } = await openTable(BTC, 79_720.01);
      await roll.connect(alice).roll(id, 0, 2, { value: parseEther("0.001") + 2n });
      const w = await roll.getCellWeights(id);
      expect(w[0]).to.equal((parseEther("0.001") + 2n) / 3n);
      expect((await roll.getTable(id)).pot).to.equal(parseEther("0.001") + 2n);
    });

    it("rejects bad cells, tiny stakes, locked and unknown tables", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await expect(roll.roll(id, 5, 4, { value: parseEther("0.01") })).to.be.revertedWithCustomError(roll, "BadCells");
      await expect(roll.roll(id, 0, 41, { value: parseEther("0.01") })).to.be.revertedWithCustomError(roll, "BadCells");
      await expect(roll.roll(id, 1, 1, { value: parseEther("0.0009") })).to.be.revertedWithCustomError(roll, "StakeTooSmall");
      await expect(roll.roll(7, 1, 1, { value: parseEther("0.01") })).to.be.revertedWithCustomError(roll, "NoSuchTable");
      await time.increaseTo(expiry - LOCK);
      await expect(roll.roll(id, 1, 1, { value: parseEther("0.01") })).to.be.revertedWithCustomError(roll, "Locked");
    });

    it("opens and rolls in one transaction, stake = value minus the Pyth fee", async () => {
      await pyth.setFee(1_000_000n);
      const now = await time.latest();
      const expiry = nextExpiry(now);
      const upd = await freshUpdate(BTC, 79_720.01);
      await expect(roll.connect(alice).openAndRoll(BTC, expiry, upd, 20, 20, { value: parseEther("0.01") + 1_000_000n }))
        .to.emit(roll, "Rolled")
        .withArgs(1n, 1n, await alice.getAddress(), 20, 20, parseEther("0.01"));
      expect((await roll.getTable(1)).pot).to.equal(parseEther("0.01"));
      await expect(roll.openAndRoll(ETH, expiry, await freshUpdate(ETH, 2_455.73), 1, 1, { value: 10n })).to.be.revertedWithCustomError(roll, "FeeNotCovered");
    });

    it("refunds what exceeds the Pyth fee on open", async () => {
      await pyth.setFee(1_000_000n);
      const now = await time.latest();
      const expiry = nextExpiry(now);
      const upd = await freshUpdate(BTC, 79_720.01);
      await expect(roll.connect(alice).open(BTC, expiry, upd, { value: 5_000_000n })).to.changeEtherBalances([alice, pyth], [-1_000_000n, 1_000_000n]);
    });
  });

  describe("settlement", () => {
    it("pays the winning cell pro rata after the rake, straight-ups and zones alike", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.connect(alice).roll(id, 20, 20, { value: parseEther("0.01") });
      await roll.connect(bob).roll(id, 18, 22, { value: parseEther("0.05") });
      await roll.connect(carol).roll(id, 5, 5, { value: parseEther("0.02") });
      await expect(roll.settle(id, await settleUpdate(BTC, 79_812, expiry))).to.be.revertedWithCustomError(roll, "TooEarly");
      await time.increaseTo(expiry);

      // 79,812 sits in number 20: [79,700, 79,900)
      const total = parseEther("0.08");
      const rake = (total * BigInt(RAKE_BPS)) / 10_000n;
      const pool = total - rake;
      await expect(roll.settle(id, await settleUpdate(BTC, 79_812, expiry, 3, -2)))
        .to.emit(roll, "Settled")
        .withArgs(id, usd(79_812), 20, pool, rake, 0n);
      const t = await roll.getTable(id);
      expect(t.status).to.equal(1);
      expect(t.winningCell).to.equal(20);
      expect(t.settlePrice).to.equal(usd(79_812));
      expect(t.payoutPool).to.equal(pool);
      expect(await roll.rakeAccrued()).to.equal(rake);

      // weights on 20: alice 0.01, bob 0.01 → half each
      expect(await roll.owed(1)).to.equal(pool / 2n);
      expect(await roll.owed(2)).to.equal(pool / 2n);
      expect(await roll.owed(3)).to.equal(0n);
      await expect(roll.claim(1)).to.changeEtherBalance(alice, pool / 2n);
      await expect(roll.connect(bob).claim(2)).to.changeEtherBalance(bob, pool / 2n);
      await expect(roll.claim(3)).to.be.revertedWithCustomError(roll, "NotAWinner");
      await expect(roll.claim(1)).to.be.revertedWithCustomError(roll, "AlreadyClaimed");
      expect(await roll.owed(1)).to.equal(0n);
      await expect(roll.sweepRake()).to.changeEtherBalance(treasury, rake);
      expect(await roll.rakeAccrued()).to.equal(0n);
      expect(await ethers.provider.getBalance(await roll.getAddress())).to.equal(0n);
    });

    it("lands the greens when the print leaves the layout", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.connect(alice).roll(id, 40, 40, { value: parseEther("0.01") }); // ABOVE
      await roll.connect(bob).roll(id, 0, 0, { value: parseEther("0.01") }); // BELOW
      await time.increaseTo(expiry);
      // top number 39 is [83,500, 83,700): 83,700 is the first price ABOVE
      await roll.settle(id, await settleUpdate(BTC, 83_700, expiry));
      expect((await roll.getTable(id)).winningCell).to.equal(40);
      expect(await roll.owed(1)).to.be.gt(0n);
      expect(await roll.owed(2)).to.equal(0n);

      const { id: id2, expiry: e2 } = await openTable(ETH, 2_455.73);
      await roll.connect(bob).roll(id2, 0, 0, { value: parseEther("0.01") });
      await time.increaseTo(e2);
      // ETH anchor 2,460, tick 10 → number 1 starts at 2,460 - 190 - 5 = 2,265
      await roll.settle(id2, await settleUpdate(ETH, 2_264.99, e2));
      expect((await roll.getTable(id2)).winningCell).to.equal(0);
      expect((await roll.getTable(id2)).settlePrice).to.equal(usd(2_264.99));
    });

    it("maps a settle price exactly at a boundary to the upper number", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.roll(id, 21, 21, { value: parseEther("0.01") });
      await time.increaseTo(expiry);
      await roll.settle(id, await settleUpdate(BTC, 79_900, expiry)); // 79,900 = upper bound of 20 = lower bound of 21
      expect((await roll.getTable(id)).winningCell).to.equal(21);
    });

    it("only accepts the first print at or after expiry, inside the window", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.roll(id, 20, 20, { value: parseEther("0.01") });
      await time.increaseTo(expiry + 60);
      // a print from before expiry
      await expect(roll.settle(id, await settleUpdate(BTC, 79_812, expiry, -1, -2))).to.be.revertedWithCustomError(pyth, "PriceFeedNotFoundWithinRange");
      // a print after expiry whose previous print was also after expiry: not the first
      await expect(roll.settle(id, await settleUpdate(BTC, 79_812, expiry, 5, 2))).to.be.revertedWithCustomError(pyth, "PriceFeedNotFoundWithinRange");
      // a print after the window
      await expect(roll.settle(id, await settleUpdate(BTC, 79_812, expiry, 16 * 60, -1))).to.be.revertedWithCustomError(pyth, "PriceFeedNotFoundWithinRange");
      // wrong feed
      const wrong = [encodeUpdate(ASSETS[ETH].feedId, usd(79_812), -8, expiry, expiry - 1)];
      await expect(roll.settle(id, wrong)).to.be.revertedWithCustomError(pyth, "PriceFeedNotFoundWithinRange");
      await roll.settle(id, await settleUpdate(BTC, 79_812, expiry, 0, -1));
      await expect(roll.settle(id, await settleUpdate(BTC, 79_812, expiry, 0, -1))).to.be.revertedWithCustomError(roll, "NotOpen");
    });

    it("rolls the pot to the next table of the asset when nobody is on the number", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.connect(alice).roll(id, 20, 20, { value: parseEther("0.03") });
      await roll.connect(bob).roll(id, 10, 12, { value: parseEther("0.03") });
      await time.increaseTo(expiry);
      await expect(roll.settle(id, await settleUpdate(BTC, 80_100, expiry))) // number 22
        .to.emit(roll, "Settled")
        .withArgs(id, usd(80_100), 22, 0n, 0n, parseEther("0.06"));
      expect(await roll.carryOf(BTC)).to.equal(parseEther("0.06"));
      expect(await roll.rakeAccrued()).to.equal(0n);
      await expect(roll.claim(1)).to.be.revertedWithCustomError(roll, "NotAWinner");

      // the ETH carry is untouched; the next BTC table absorbs it
      const { id: ethId } = await openTable(ETH, 2_455.73);
      expect((await roll.getTable(ethId)).carry).to.equal(0n);
      const { id: id2, expiry: e2 } = await openTable(BTC, 80_100);
      const t2 = await roll.getTable(id2);
      expect(t2.carry).to.equal(parseEther("0.06"));
      expect(await roll.carryOf(BTC)).to.equal(0n);

      await roll.connect(carol).roll(id2, 20, 20, { value: parseEther("0.01") });
      await time.increaseTo(e2);
      await roll.settle(id2, await settleUpdate(BTC, 80_100, e2));
      const total = parseEther("0.07");
      const pool = total - (total * BigInt(RAKE_BPS)) / 10_000n;
      expect(await roll.owed(3)).to.equal(pool);
      await expect(roll.claim(3)).to.changeEtherBalance(carol, pool);
    });

    it("keeps rolling a pot nobody hits, table after table", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.roll(id, 1, 1, { value: parseEther("0.01") });
      await time.increaseTo(expiry);
      await roll.settle(id, await settleUpdate(BTC, 79_800, expiry));
      const { id: id2, expiry: e2 } = await openTable(BTC, 79_800);
      await roll.roll(id2, 1, 1, { value: parseEther("0.02") });
      await time.increaseTo(e2);
      await roll.settle(id2, await settleUpdate(BTC, 79_800, e2));
      expect(await roll.carryOf(BTC)).to.equal(parseEther("0.03"));
    });

    it("voids a table nobody settled in three days and refunds every roll", async () => {
      // seed a carry first
      const { id: id0, expiry: e0 } = await openTable(BTC, 79_720.01);
      await roll.roll(id0, 1, 1, { value: parseEther("0.01") });
      await time.increaseTo(e0);
      await roll.settle(id0, await settleUpdate(BTC, 79_800, e0));

      const { id, expiry } = await openTable(BTC, 79_800);
      expect((await roll.getTable(id)).carry).to.equal(parseEther("0.01"));
      await roll.connect(alice).roll(id, 20, 20, { value: parseEther("0.02") });
      await roll.connect(bob).roll(id, 3, 7, { value: parseEther("0.05") });
      await time.increaseTo(expiry + 3 * DAY - 2); // the void tx lands at exactly expiry + 3 days
      await expect(roll.voidTable(id)).to.be.revertedWithCustomError(roll, "TooEarly");
      await time.increaseTo(expiry + 3 * DAY); // the next tx lands one second later
      await expect(roll.voidTable(id)).to.emit(roll, "Voided").withArgs(id, parseEther("0.01"));
      expect((await roll.getTable(id)).status).to.equal(2);
      expect(await roll.carryOf(BTC)).to.equal(parseEther("0.01"));
      expect(await roll.owed(2)).to.equal(parseEther("0.02"));
      expect(await roll.owed(3)).to.equal(parseEther("0.05"));
      await expect(roll.claimMany([2, 3])).to.changeEtherBalances([alice, bob], [parseEther("0.02"), parseEther("0.05")]);
      await expect(roll.settle(id, await settleUpdate(BTC, 79_800, expiry))).to.be.revertedWithCustomError(roll, "NotOpen");
      await expect(roll.voidTable(id)).to.be.revertedWithCustomError(roll, "NotOpen");
      expect(await ethers.provider.getBalance(await roll.getAddress())).to.equal(parseEther("0.01"));
    });

    it("cannot be settled twice, claimed before settlement, or voided while settleable", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.roll(id, 20, 20, { value: parseEther("0.01") });
      await expect(roll.claim(1)).to.be.revertedWithCustomError(roll, "NotSettled");
      await time.increaseTo(expiry + 1);
      await expect(roll.voidTable(id)).to.be.revertedWithCustomError(roll, "TooEarly");
    });

    it("forwards the Pyth fee on settlement and refunds the excess", async () => {
      const { id, expiry } = await openTable(BTC, 79_720.01);
      await roll.connect(alice).roll(id, 20, 20, { value: parseEther("0.01") });
      await pyth.setFee(2_000_000n);
      await time.increaseTo(expiry);
      const upd = await settleUpdate(BTC, 79_800, expiry);
      await expect(roll.connect(bob).settle(id, upd, { value: 1n })).to.be.revertedWithCustomError(roll, "FeeNotCovered");
      await expect(roll.connect(bob).settle(id, upd, { value: 9_000_000n })).to.changeEtherBalances([bob, pyth], [-2_000_000n, 2_000_000n]);
    });
  });

  describe("deployment guards", () => {
    it("caps the rake at 10 % and requires a treasury", async () => {
      const factory = await ethers.getContractFactory("Roll");
      await expect(factory.deploy(await pyth.getAddress(), treasuryAddr, 1_001, assetTuples())).to.be.revertedWith("rake > 10%");
      await expect(factory.deploy(await pyth.getAddress(), ethers.ZeroAddress, 270, assetTuples())).to.be.revertedWith("zero address");
      expect(await roll.assetCount()).to.equal(BigInt(ASSETS.length));
      const a = await roll.getAsset(0);
      expect(a.symbol).to.equal("BTC");
      expect(a.feedId).to.equal(ASSETS[0].feedId);
      expect(await roll.rakeBps()).to.equal(RAKE_BPS);
      expect(await roll.treasury()).to.equal(treasuryAddr);
    });
  });
});

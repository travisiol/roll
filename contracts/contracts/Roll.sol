// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth, PythStructs} from "./interfaces/IPyth.sol";

/**
 * ROLL — don't pick a side, pick the price.
 *
 * A table is one asset and one expiry. Its layout is a row of price cells
 * ("numbers") one tick wide, centred on the price when the table opened,
 * plus two green cells for prices that leave the layout: BELOW and ABOVE.
 * A roll is a stake on a contiguous run of cells — one cell is the exact
 * price, several cells are a zone. The stake is spread evenly over the
 * cells it covers, so a wide zone lands more often and pays less, the way
 * a street pays less than a straight-up.
 *
 * Every stake on a table goes into one pot. At expiry the first Pyth print
 * at or after the expiry timestamp picks exactly one winning cell; the
 * weight sitting on that cell shares the pot (minus the rake) pro rata.
 * If no weight sits on the winning cell, the whole pot rolls: it becomes
 * the carry of the next table opened for that asset.
 *
 * No owner, no operator. Anyone opens a table on the schedule, anyone
 * settles it with a Pyth update, anyone sweeps the rake to the treasury.
 * Nothing but the settled price decides who is paid.
 */
contract Roll {
    // ---------------------------------------------------------------- rules

    /// Rolls close this long before expiry.
    uint256 public constant LOCK = 1 hours;
    /// A table can be opened this long before its expiry — the next table
    /// becomes openable exactly when the current one locks.
    uint256 public constant HORIZON = 25 hours;
    /// The settlement print must be the first Pyth print at or after expiry,
    /// and no later than this after it.
    uint256 public constant SETTLE_WINDOW = 15 minutes;
    /// A table nobody settled this long after expiry can be voided: every
    /// roll is refunded in full and the carry waits for the next table.
    uint256 public constant VOID_AFTER = 3 days;
    /// The print that anchors a new layout may be at most this old.
    uint256 public constant MAX_ANCHOR_AGE = 120;
    /// Expiries: one per day, at PHASE past midnight UTC.
    uint256 public constant CADENCE = 1 days;
    uint256 public constant PHASE = 16 hours;
    uint256 public constant MIN_STAKE = 0.001 ether;
    /// Prices are handled in 1e-8 USD units, whatever the feed's exponent.
    int64 public constant PRICE_UNIT = 1e8;

    uint8 public constant BELOW = 0;

    struct Asset {
        bytes32 feedId;
        string symbol;
        /// Tick target as a fraction of the anchor price, in basis points;
        /// the tick actually used is the nearest 1 / 2 / 5 × 10^k of it.
        uint16 tickBps;
        /// Numbers on each side of the anchor number.
        uint8 halfWidth;
    }

    enum Status {
        Open,
        Settled,
        Void
    }

    struct Table {
        uint8 asset;
        Status status;
        uint8 cells; // 2 * halfWidth + 1 numbers + 2 greens
        uint8 winningCell;
        uint64 expiry;
        uint64 openedAt;
        int64 anchor; // price of the middle number, 1e-8 USD
        int64 tick; // width of a number, 1e-8 USD
        int64 settlePrice;
        uint256 pot; // sum of stakes
        uint256 carry; // rolled in from earlier tables of the asset
        uint256 payoutPool; // pot + carry - rake once settled with a winner
    }

    struct Ticket {
        uint256 tableId;
        address owner;
        uint8 lo;
        uint8 hi;
        bool claimed;
        uint256 stake;
    }

    IPyth public immutable pyth;
    address public immutable treasury;
    uint16 public immutable rakeBps;

    Asset[] private _assets;

    uint256 public tableCount;
    mapping(uint256 => Table) private _tables;
    /// asset → expiry → table id (0 = none).
    mapping(uint8 => mapping(uint64 => uint256)) public tableOf;
    /// table id → cell → weight (stake / cells covered), summed over rolls.
    mapping(uint256 => mapping(uint8 => uint256)) public cellWeight;
    /// Pot of a no-winner table, waiting for the next table of the asset.
    mapping(uint8 => uint256) public carryOf;

    uint256 public rollCount;
    mapping(uint256 => Ticket) private _rolls;
    mapping(address => uint256[]) private _rollsOf;

    uint256 public rakeAccrued;

    uint256 private _entered = 1;

    event TableOpened(uint256 indexed tableId, uint8 indexed asset, uint64 expiry, int64 anchor, int64 tick, uint8 cells, uint256 carry);
    event Rolled(uint256 indexed rollId, uint256 indexed tableId, address indexed owner, uint8 lo, uint8 hi, uint256 stake);
    event Settled(uint256 indexed tableId, int64 price, uint8 winningCell, uint256 payoutPool, uint256 rake, uint256 rolledOver);
    event Voided(uint256 indexed tableId, uint256 carryReturned);
    event Claimed(uint256 indexed rollId, address indexed owner, uint256 amount);
    event RakeSwept(uint256 amount);

    error UnknownAsset();
    error OffSchedule();
    error TooLate();
    error TooEarly();
    error TableExists();
    error NoSuchTable();
    error NotOpen();
    error Locked();
    error BadCells();
    error StakeTooSmall();
    error FeeNotCovered();
    error NotSettled();
    error NotAWinner();
    error AlreadyClaimed();
    error Reentrancy();
    error TransferFailed();
    error BadPrice();

    modifier nonReentrant() {
        if (_entered != 1) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor(IPyth pyth_, address treasury_, uint16 rakeBps_, Asset[] memory assets_) {
        require(address(pyth_) != address(0) && treasury_ != address(0), "zero address");
        require(rakeBps_ <= 1000, "rake > 10%");
        require(assets_.length > 0 && assets_.length <= 32, "assets");
        pyth = pyth_;
        treasury = treasury_;
        rakeBps = rakeBps_;
        for (uint256 i = 0; i < assets_.length; i++) {
            Asset memory a = assets_[i];
            require(a.feedId != bytes32(0) && a.tickBps > 0 && a.halfWidth > 0 && a.halfWidth <= 60, "asset");
            _assets.push(a);
        }
    }

    // ------------------------------------------------------------- schedule

    /// The next expiry whose rolls are still open at `at`.
    function currentExpiry(uint256 at) public pure returns (uint64) {
        // smallest E = k * CADENCE + PHASE with E - LOCK > at
        uint256 e = ((at + LOCK) / CADENCE) * CADENCE + PHASE;
        while (e <= at + LOCK) e += CADENCE;
        return uint64(e);
    }

    function isScheduled(uint64 expiry) public pure returns (bool) {
        return expiry % CADENCE == PHASE;
    }

    // ---------------------------------------------------------------- views

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function getAsset(uint8 asset) external view returns (Asset memory) {
        if (asset >= _assets.length) revert UnknownAsset();
        return _assets[asset];
    }

    function getTable(uint256 tableId) external view returns (Table memory) {
        if (tableId == 0 || tableId > tableCount) revert NoSuchTable();
        return _tables[tableId];
    }

    function getCellWeights(uint256 tableId) external view returns (uint256[] memory weights) {
        if (tableId == 0 || tableId > tableCount) revert NoSuchTable();
        uint8 n = _tables[tableId].cells;
        weights = new uint256[](n);
        for (uint8 c = 0; c < n; c++) weights[c] = cellWeight[tableId][c];
    }

    function getRoll(uint256 rollId) external view returns (Ticket memory) {
        return _rolls[rollId];
    }

    function rollsOf(address owner) external view returns (uint256[] memory) {
        return _rollsOf[owner];
    }

    /// Lower (inclusive) and upper (exclusive) price of a numbered cell.
    /// Greens have no bounds: BELOW is everything under number 1, ABOVE
    /// everything from the top number's upper bound.
    function cellBounds(uint256 tableId, uint8 cell) public view returns (int64 lower, int64 upper) {
        Table storage t = _tables[tableId];
        if (t.expiry == 0) revert NoSuchTable();
        if (cell == BELOW || cell >= t.cells - 1) revert BadCells();
        int64 half = int64(uint64(t.cells - 2)) / 2; // == halfWidth
        int64 centre = t.anchor + (int64(uint64(cell)) - 1 - half) * t.tick;
        lower = centre - t.tick / 2;
        upper = centre + t.tick / 2;
    }

    /// The layout a table would get if it opened now at `price` (1e-8 USD):
    /// the site draws it before the table exists.
    function previewLayout(uint8 asset, int64 price) external view returns (int64 anchor, int64 tick, uint8 cells) {
        if (asset >= _assets.length) revert UnknownAsset();
        (anchor, tick) = _layout(_assets[asset], price);
        cells = _assets[asset].halfWidth * 2 + 3;
    }

    /// How much a roll is owed right now: 0 while its table is open, its
    /// share once settled, its stake once voided.
    function owed(uint256 rollId) external view returns (uint256) {
        Ticket storage r = _rolls[rollId];
        if (r.owner == address(0) || r.claimed) return 0;
        Table storage t = _tables[r.tableId];
        if (t.status == Status.Void) return r.stake;
        if (t.status != Status.Settled) return 0;
        if (t.winningCell < r.lo || t.winningCell > r.hi) return 0;
        return _share(t, r);
    }

    // -------------------------------------------------------------- opening

    /// Opens the table (asset, expiry). `updateData` is a Pyth update for the
    /// asset's feed no older than MAX_ANCHOR_AGE: its price anchors the layout.
    /// msg.value covers the Pyth fee; the excess is returned.
    function open(uint8 asset, uint64 expiry, bytes[] calldata updateData) external payable nonReentrant returns (uint256 tableId) {
        uint256 fee = _pythFee(updateData);
        tableId = _open(asset, expiry, updateData, fee);
        _refund(msg.value - fee);
    }

    /// Opens the table and places the first roll in one transaction. The
    /// stake is msg.value minus the Pyth fee.
    function openAndRoll(uint8 asset, uint64 expiry, bytes[] calldata updateData, uint8 lo, uint8 hi)
        external
        payable
        nonReentrant
        returns (uint256 tableId, uint256 rollId)
    {
        uint256 fee = _pythFee(updateData);
        tableId = _open(asset, expiry, updateData, fee);
        rollId = _roll(tableId, lo, hi, msg.value - fee);
    }

    /// Stakes msg.value on cells lo..hi (inclusive) of an open table.
    function roll(uint256 tableId, uint8 lo, uint8 hi) external payable nonReentrant returns (uint256 rollId) {
        rollId = _roll(tableId, lo, hi, msg.value);
    }

    // ------------------------------------------------------------ settlement

    /// Settles with the first Pyth print at or after expiry. `updateData` is
    /// the Hermes benchmark update for the expiry timestamp; Pyth itself
    /// rejects anything that is not the first print in the window.
    function settle(uint256 tableId, bytes[] calldata updateData) external payable nonReentrant {
        Table storage t = _tables[tableId];
        if (t.expiry == 0) revert NoSuchTable();
        if (t.status != Status.Open) revert NotOpen();
        if (block.timestamp < t.expiry) revert TooEarly();
        uint256 fee = _pythFee(updateData);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = _assets[t.asset].feedId;
        PythStructs.PriceFeed[] memory feeds =
            pyth.parsePriceFeedUpdatesUnique{value: fee}(updateData, ids, t.expiry, uint64(t.expiry + SETTLE_WINDOW));
        int64 price = _normalize(feeds[0].price.price, feeds[0].price.expo);
        uint8 cell = _cellOf(t, price);

        t.status = Status.Settled;
        t.settlePrice = price;
        t.winningCell = cell;
        uint256 total = t.pot + t.carry;
        if (cellWeight[tableId][cell] == 0) {
            // Nobody on the number: the whole pot rolls to the next table.
            carryOf[t.asset] += total;
            emit Settled(tableId, price, cell, 0, 0, total);
        } else {
            uint256 rake = (total * rakeBps) / 10_000;
            rakeAccrued += rake;
            t.payoutPool = total - rake;
            emit Settled(tableId, price, cell, t.payoutPool, rake, 0);
        }
        _refund(msg.value - fee);
    }

    /// A table still unsettled VOID_AFTER past expiry (no valid print was
    /// ever submitted) refunds every roll; its carry waits for the next table.
    function voidTable(uint256 tableId) external {
        Table storage t = _tables[tableId];
        if (t.expiry == 0) revert NoSuchTable();
        if (t.status != Status.Open) revert NotOpen();
        if (block.timestamp <= t.expiry + VOID_AFTER) revert TooEarly();
        t.status = Status.Void;
        carryOf[t.asset] += t.carry;
        emit Voided(tableId, t.carry);
    }

    /// Pays a roll to its owner: its share of a settled table, or its stake
    /// back from a voided one. Anyone may trigger it.
    function claim(uint256 rollId) public nonReentrant {
        _claim(rollId);
    }

    function claimMany(uint256[] calldata rollIds) external nonReentrant {
        for (uint256 i = 0; i < rollIds.length; i++) _claim(rollIds[i]);
    }

    function sweepRake() external nonReentrant {
        uint256 amount = rakeAccrued;
        rakeAccrued = 0;
        _pay(treasury, amount);
        emit RakeSwept(amount);
    }

    // ----------------------------------------------------------- internals

    function _open(uint8 asset, uint64 expiry, bytes[] calldata updateData, uint256 fee) private returns (uint256 tableId) {
        if (asset >= _assets.length) revert UnknownAsset();
        if (!isScheduled(expiry)) revert OffSchedule();
        if (expiry <= block.timestamp + LOCK) revert TooLate();
        if (expiry > block.timestamp + HORIZON) revert TooEarly();
        if (tableOf[asset][expiry] != 0) revert TableExists();

        Asset storage a = _assets[asset];
        pyth.updatePriceFeeds{value: fee}(updateData);
        PythStructs.Price memory p = pyth.getPriceNoOlderThan(a.feedId, MAX_ANCHOR_AGE);
        int64 price = _normalize(p.price, p.expo);
        (int64 anchor, int64 tick) = _layout(a, price);

        tableId = ++tableCount;
        uint256 carry = carryOf[asset];
        carryOf[asset] = 0;
        Table storage t = _tables[tableId];
        t.asset = asset;
        t.status = Status.Open;
        t.cells = a.halfWidth * 2 + 3;
        t.expiry = expiry;
        t.openedAt = uint64(block.timestamp);
        t.anchor = anchor;
        t.tick = tick;
        t.carry = carry;
        tableOf[asset][expiry] = tableId;
        emit TableOpened(tableId, asset, expiry, anchor, tick, t.cells, carry);
    }

    function _roll(uint256 tableId, uint8 lo, uint8 hi, uint256 stake) private returns (uint256 rollId) {
        Table storage t = _tables[tableId];
        if (t.expiry == 0) revert NoSuchTable();
        if (t.status != Status.Open) revert NotOpen();
        if (block.timestamp + LOCK >= t.expiry) revert Locked();
        if (lo > hi || hi >= t.cells) revert BadCells();
        if (stake < MIN_STAKE) revert StakeTooSmall();

        uint256 width = uint256(hi) - uint256(lo) + 1;
        uint256 weight = stake / width; // the remainder stays in the pot
        for (uint8 c = lo; c <= hi; c++) cellWeight[tableId][c] += weight;
        t.pot += stake;

        rollId = ++rollCount;
        _rolls[rollId] = Ticket({tableId: tableId, owner: msg.sender, lo: lo, hi: hi, claimed: false, stake: stake});
        _rollsOf[msg.sender].push(rollId);
        emit Rolled(rollId, tableId, msg.sender, lo, hi, stake);
    }

    function _claim(uint256 rollId) private {
        Ticket storage r = _rolls[rollId];
        if (r.owner == address(0)) revert NoSuchTable();
        if (r.claimed) revert AlreadyClaimed();
        Table storage t = _tables[r.tableId];
        uint256 amount;
        if (t.status == Status.Void) {
            amount = r.stake;
        } else if (t.status == Status.Settled) {
            if (t.winningCell < r.lo || t.winningCell > r.hi) revert NotAWinner();
            amount = _share(t, r);
        } else {
            revert NotSettled();
        }
        r.claimed = true;
        _pay(r.owner, amount);
        emit Claimed(rollId, r.owner, amount);
    }

    function _share(Table storage t, Ticket storage r) private view returns (uint256) {
        uint256 weight = r.stake / (uint256(r.hi) - uint256(r.lo) + 1);
        return (t.payoutPool * weight) / cellWeight[r.tableId][t.winningCell];
    }

    /// Nearest 1 / 2 / 5 × 10^k (in log terms) of the asset's tick target.
    function _layout(Asset storage a, int64 price) private view returns (int64 anchor, int64 tick) {
        if (price <= 0) revert BadPrice();
        uint256 target = (uint256(uint64(price)) * a.tickBps) / 10_000;
        if (target == 0) target = 1;
        uint256 pow = 1;
        while (pow * 10 <= target) pow *= 10;
        // log-midpoints: sqrt(2), sqrt(10), sqrt(50) → compare squares
        uint256 sq = target * target;
        uint256 p2 = pow * pow;
        uint256 nice;
        if (sq < 2 * p2) nice = pow;
        else if (sq < 10 * p2) nice = 2 * pow;
        else if (sq < 50 * p2) nice = 5 * pow;
        else nice = 10 * pow;
        tick = int64(uint64(nice));
        // round the price to the nearest tick
        int64 half = tick / 2;
        anchor = ((price + half) / tick) * tick;
        if (anchor <= 0) revert BadPrice();
    }

    function _cellOf(Table storage t, int64 price) private view returns (uint8) {
        int64 half = int64(uint64(t.cells - 2)) / 2;
        int64 lowEdge = t.anchor - half * t.tick - t.tick / 2;
        if (price < lowEdge) return BELOW;
        int64 numbers = int64(uint64(t.cells - 2));
        int64 offset = (price - lowEdge) / t.tick; // 0-based number index
        if (offset >= numbers) return t.cells - 1; // ABOVE
        return uint8(uint64(offset)) + 1;
    }

    /// Any Pyth exponent → 1e-8 USD units.
    function _normalize(int64 price, int32 expo) private pure returns (int64) {
        if (price <= 0) revert BadPrice();
        if (expo == -8) return price;
        int256 p = int256(price);
        if (expo > -8) {
            for (int32 i = expo; i > -8; i--) p *= 10;
        } else {
            for (int32 i = expo; i < -8; i++) p /= 10;
        }
        if (p <= 0 || p > type(int64).max) revert BadPrice();
        return int64(p);
    }

    function _pythFee(bytes[] calldata updateData) private view returns (uint256 fee) {
        fee = pyth.getUpdateFee(updateData);
        if (msg.value < fee) revert FeeNotCovered();
    }

    function _refund(uint256 amount) private {
        if (amount > 0) _pay(msg.sender, amount);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

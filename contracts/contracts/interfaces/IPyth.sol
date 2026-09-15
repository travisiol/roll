// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

// The slice of Pyth's on-chain interface ROLL uses, with the exact
// signatures of the pyth-sdk-solidity package so the selectors match the
// deployment on Robinhood Chain (0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a,
// version 1.4.5-alpha.1 — parsePriceFeedUpdatesUnique verified present in
// its implementation bytecode on 2026-09-15).
library PythStructs {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    struct PriceFeed {
        bytes32 id;
        Price price;
        Price emaPrice;
    }
}

interface IPyth {
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);

    function updatePriceFeeds(bytes[] calldata updateData) external payable;

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythStructs.Price memory price);

    function getPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory price);

    function priceFeedExists(bytes32 id) external view returns (bool);

    /// Returns the price updates in `updateData` whose publish time lies in
    /// [minPublishTime, maxPublishTime] AND that are the first update at or
    /// after minPublishTime (prevPublishTime < minPublishTime). That is what
    /// makes a settlement price unique: the first print at or after expiry.
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory priceFeeds);
}

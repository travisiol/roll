// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth, PythStructs} from "../interfaces/IPyth.sol";

/// A Pyth stand-in for tests and the local table. An "update" is
/// abi.encode(id, price, conf, expo, publishTime, prevPublishTime); the
/// uniqueness rule of parsePriceFeedUpdatesUnique is enforced the way the
/// real contract does it (prevPublishTime < min <= publishTime <= max).
contract MockPyth is IPyth {
    uint256 public singleUpdateFee;
    mapping(bytes32 => PythStructs.Price) private _latest;
    mapping(bytes32 => bool) private _exists;

    error InsufficientFee();
    error StalePrice();
    error PriceFeedNotFound();
    error PriceFeedNotFoundWithinRange();

    constructor(uint256 fee) {
        singleUpdateFee = fee;
    }

    function setFee(uint256 fee) external {
        singleUpdateFee = fee;
    }

    function encode(bytes32 id, int64 price, uint64 conf, int32 expo, uint64 publishTime, uint64 prevPublishTime)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(id, price, conf, expo, publishTime, prevPublishTime);
    }

    function getUpdateFee(bytes[] calldata updateData) public view returns (uint256) {
        return singleUpdateFee * updateData.length;
    }

    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        if (msg.value < getUpdateFee(updateData)) revert InsufficientFee();
        for (uint256 i = 0; i < updateData.length; i++) {
            (bytes32 id, PythStructs.Price memory p,) = _decode(updateData[i]);
            if (!_exists[id] || p.publishTime > _latest[id].publishTime) {
                _latest[id] = p;
                _exists[id] = true;
            }
        }
    }

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythStructs.Price memory price) {
        if (!_exists[id]) revert PriceFeedNotFound();
        price = _latest[id];
        if (block.timestamp > price.publishTime && block.timestamp - price.publishTime > age) revert StalePrice();
    }

    function getPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory) {
        if (!_exists[id]) revert PriceFeedNotFound();
        return _latest[id];
    }

    function priceFeedExists(bytes32 id) external view returns (bool) {
        return _exists[id];
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory priceFeeds) {
        if (msg.value < getUpdateFee(updateData)) revert InsufficientFee();
        priceFeeds = new PythStructs.PriceFeed[](priceIds.length);
        for (uint256 k = 0; k < priceIds.length; k++) {
            bool found;
            for (uint256 i = 0; i < updateData.length && !found; i++) {
                (bytes32 id, PythStructs.Price memory p, uint64 prev) = _decode(updateData[i]);
                if (id != priceIds[k]) continue;
                if (p.publishTime < minPublishTime || p.publishTime > maxPublishTime) continue;
                if (prev >= minPublishTime) continue; // not the first print at/after min
                priceFeeds[k] = PythStructs.PriceFeed({id: id, price: p, emaPrice: p});
                found = true;
                if (!_exists[id] || p.publishTime > _latest[id].publishTime) {
                    _latest[id] = p;
                    _exists[id] = true;
                }
            }
            if (!found) revert PriceFeedNotFoundWithinRange();
        }
    }

    function _decode(bytes calldata data) private pure returns (bytes32 id, PythStructs.Price memory p, uint64 prev) {
        (bytes32 id_, int64 price, uint64 conf, int32 expo, uint64 publishTime, uint64 prevPublishTime) =
            abi.decode(data, (bytes32, int64, uint64, int32, uint64, uint64));
        id = id_;
        p = PythStructs.Price({price: price, conf: conf, expo: expo, publishTime: publishTime});
        prev = prevPublishTime;
    }
}

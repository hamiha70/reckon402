// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice EIP-3668 OffchainLookup error definition.
interface IERC3668 {
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );
}

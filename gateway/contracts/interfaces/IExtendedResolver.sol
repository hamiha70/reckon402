// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice ENSIP-10 IExtendedResolver — wildcard resolution support.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory);
}

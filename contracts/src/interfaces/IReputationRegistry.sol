// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal slice of ERC-8004 ReputationRegistry that the Escrow needs.
///         Matches the upstream `getSummary` ABI at the pinned commit
///         `0463311492b3a7fc5fdb6990231cce721ff6cf97` (see AGENTS.md L4a2).
///         Reverts on empty `clientAddresses` per upstream behaviour — the
///         Escrow always passes a single facilitator EOA.
interface IReputationRegistry {
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string  calldata tag1,
        string  calldata tag2
    )
        external
        view
        returns (
            uint64 count,
            int128 summaryValue,
            uint8  summaryValueDecimals
        );
}

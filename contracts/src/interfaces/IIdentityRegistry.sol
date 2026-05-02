// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal slice of ERC-8004 IdentityRegistry that the Escrow needs.
///         Intentionally subsetted (not the full ERC-721 surface) — the
///         Escrow only needs to know who currently owns the agent NFT.
interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

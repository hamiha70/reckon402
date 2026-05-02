// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  Reckon402 tier-strategy interface
/// @notice A pluggable evaluator for the risk-buffer release curve. The
///         Escrow contract delegates to an `ITierStrategy` on every
///         `releasedBps()` read; different strategies can implement
///         linear ramps, bonding curves, or per-agent custom shapes.
///
/// @dev    Implementations MUST be deterministic and side-effect-free
///         under STATICCALL. The Escrow expects a uint16 in the closed
///         range [0, 10_000]; values above the cap are not validated by
///         the Escrow itself and would produce nonsensical
///         release-amount arithmetic.
///
///         `agentId` is forwarded for the benefit of future strategies
///         that key on per-agent state. The default
///         `LinearMonotonicTierStrategy` ignores it.
interface ITierStrategy {
    /// @notice Compute the unlocked release fraction in BPS.
    /// @param  agentId           ERC-8004 IdentityRegistry token id of
    ///                           the agent owning the calling Escrow.
    /// @param  attestationCount  count of facilitator-signed attestations
    ///                           the Escrow has read from the
    ///                           ReputationRegistry.
    /// @return releaseBps        ∈ [0, 10_000]. The Escrow multiplies by
    ///                           `totalDeposited` and divides by 10_000
    ///                           to obtain the cumulative unlock cap.
    function evaluate(uint256 agentId, uint64 attestationCount)
        external
        view
        returns (uint16 releaseBps);
}

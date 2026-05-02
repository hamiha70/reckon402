// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ITierStrategy } from "./interfaces/ITierStrategy.sol";

/// @title  Linear monotonic tier strategy (v1)
/// @notice Default `ITierStrategy` implementation. Holds a parallel pair
///         of arrays — `thresholds` (strictly increasing) and
///         `releaseBps` (non-decreasing, each ≤ 10_000) — and returns
///         the highest qualifying release fraction for a given
///         attestation count.
///
/// @dev    Pure tier-math; no agent-specific state. Strategies are
///         shareable across many Escrows. The arrays are immutable
///         after deploy — to ramp differently, deploy a new strategy.
///         Constructor validation is intentionally identical to the
///         pre-refactor inline validation that lived in Escrow.sol so
///         no acceptance regression is introduced by the move.
contract LinearMonotonicTierStrategy is ITierStrategy {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    uint64[] private _thresholds;
    uint16[] private _releaseBps;

    error TierLengthsMismatch();
    error TierThresholdsNotMonotonic();
    error TierBpsNotMonotonic();
    error TierBpsExceedsDenominator();

    event StrategyDeployed(uint64[] thresholds, uint16[] releaseBps);

    constructor(
        uint64[] memory thresholds_,
        uint16[] memory releaseBps_
    ) {
        uint256 n = thresholds_.length;
        if (n == 0 || n != releaseBps_.length) revert TierLengthsMismatch();

        for (uint256 i = 0; i < n; ++i) {
            if (i > 0 && thresholds_[i] <= thresholds_[i - 1]) {
                revert TierThresholdsNotMonotonic();
            }
            if (releaseBps_[i] > BPS_DENOMINATOR) {
                revert TierBpsExceedsDenominator();
            }
            if (i > 0 && releaseBps_[i] < releaseBps_[i - 1]) {
                revert TierBpsNotMonotonic();
            }
        }

        _thresholds = thresholds_;
        _releaseBps = releaseBps_;

        emit StrategyDeployed(thresholds_, releaseBps_);
    }

    /// @inheritdoc ITierStrategy
    /// @dev `agentId` is unused in v1; preserved in the interface for
    ///      future strategies that want per-agent shape.
    function evaluate(uint256 /* agentId */, uint64 attestationCount)
        external
        view
        returns (uint16)
    {
        uint16 best  = 0;
        uint256 n = _thresholds.length;
        for (uint256 i = 0; i < n; ++i) {
            if (attestationCount >= _thresholds[i]) {
                best = _releaseBps[i];
            } else {
                break;
            }
        }
        return best;
    }

    /// @notice Tier-curve thresholds (strictly increasing). For dashboards.
    function thresholds() external view returns (uint64[] memory) {
        return _thresholds;
    }

    /// @notice Tier-curve release fractions in BPS (non-decreasing, ≤ 10_000).
    function releaseBpsArr() external view returns (uint16[] memory) {
        return _releaseBps;
    }

    /// @notice Both arrays in one eth_call (saves a round-trip for dashboards).
    function config()
        external
        view
        returns (uint64[] memory thresholds_, uint16[] memory releaseBps_)
    {
        return (_thresholds, _releaseBps);
    }
}

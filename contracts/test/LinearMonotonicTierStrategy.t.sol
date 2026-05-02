// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm }   from "forge-std/Vm.sol";
import { LinearMonotonicTierStrategy } from "../src/LinearMonotonicTierStrategy.sol";

/// @notice Unit tests for the v1 linear monotonic tier strategy. These
///         absorb the constructor-validation cases that lived in
///         `Escrow.t.sol` before the L4d-pluggable refactor, plus the
///         tier-ramp evaluation cases that previously sat behind
///         `escrow.releasedBps()`.
contract LinearMonotonicTierStrategyTest is Test {
    uint256 internal constant DUMMY_AGENT_ID = 42;

    uint64[] internal defaultThresholds;
    uint16[] internal defaultBps;

    function setUp() public {
        // 8-tier default curve from specs/09-l4d-escrow.md.
        defaultThresholds = new uint64[](8);
        defaultBps        = new uint16[](8);
        defaultThresholds[0] = 0;     defaultBps[0] = 0;
        defaultThresholds[1] = 1;     defaultBps[1] = 500;
        defaultThresholds[2] = 3;     defaultBps[2] = 1500;
        defaultThresholds[3] = 10;    defaultBps[3] = 3000;
        defaultThresholds[4] = 30;    defaultBps[4] = 5000;
        defaultThresholds[5] = 100;   defaultBps[5] = 7000;
        defaultThresholds[6] = 300;   defaultBps[6] = 8500;
        defaultThresholds[7] = 1000;  defaultBps[7] = 10000;
    }

    // ─────────────────────── Constructor invariants ───────────────────────

    function test_ctor_lengthMismatch_reverts() public {
        uint64[] memory ths = new uint64[](2); ths[0] = 0; ths[1] = 1;
        uint16[] memory bps = new uint16[](3); bps[0] = 0; bps[1] = 500; bps[2] = 1000;
        vm.expectRevert(LinearMonotonicTierStrategy.TierLengthsMismatch.selector);
        new LinearMonotonicTierStrategy(ths, bps);
    }

    function test_ctor_emptyTierArrays_reverts() public {
        uint64[] memory ths = new uint64[](0);
        uint16[] memory bps = new uint16[](0);
        vm.expectRevert(LinearMonotonicTierStrategy.TierLengthsMismatch.selector);
        new LinearMonotonicTierStrategy(ths, bps);
    }

    function test_ctor_nonMonotonicThresholds_reverts() public {
        uint64[] memory ths = new uint64[](3); ths[0] = 0; ths[1] = 5; ths[2] = 5;
        uint16[] memory bps = new uint16[](3); bps[0] = 0; bps[1] = 500; bps[2] = 1000;
        vm.expectRevert(LinearMonotonicTierStrategy.TierThresholdsNotMonotonic.selector);
        new LinearMonotonicTierStrategy(ths, bps);
    }

    function test_ctor_decreasingBps_reverts() public {
        uint64[] memory ths = new uint64[](3); ths[0] = 0; ths[1] = 1; ths[2] = 2;
        uint16[] memory bps = new uint16[](3); bps[0] = 500; bps[1] = 200; bps[2] = 1000;
        vm.expectRevert(LinearMonotonicTierStrategy.TierBpsNotMonotonic.selector);
        new LinearMonotonicTierStrategy(ths, bps);
    }

    function test_ctor_bpsAboveDenominator_reverts() public {
        uint64[] memory ths = new uint64[](2); ths[0] = 0; ths[1] = 1;
        uint16[] memory bps = new uint16[](2); bps[0] = 0; bps[1] = 10001;
        vm.expectRevert(LinearMonotonicTierStrategy.TierBpsExceedsDenominator.selector);
        new LinearMonotonicTierStrategy(ths, bps);
    }

    function test_ctor_validCurve_emitsDeployedEvent() public {
        vm.recordLogs();
        new LinearMonotonicTierStrategy(defaultThresholds, defaultBps);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 1, "exactly one event expected");
        assertEq(
            entries[0].topics[0],
            keccak256("StrategyDeployed(uint64[],uint16[])"),
            "event signature mismatch"
        );
    }

    // ─────────────────────── Evaluation ───────────────────────

    function _make() internal returns (LinearMonotonicTierStrategy) {
        return new LinearMonotonicTierStrategy(defaultThresholds, defaultBps);
    }

    function test_evaluate_atZeroCount_isT0() public {
        LinearMonotonicTierStrategy s = _make();
        assertEq(s.evaluate(DUMMY_AGENT_ID, 0), 0);
    }

    function test_evaluate_atFirstThreshold_isT1() public {
        LinearMonotonicTierStrategy s = _make();
        assertEq(s.evaluate(DUMMY_AGENT_ID, 1), 500);
    }

    function test_evaluate_betweenThresholds_returnsLowerTier() public {
        LinearMonotonicTierStrategy s = _make();
        // count=2 sits between T1(threshold=1) and T2(threshold=3) — must round down.
        assertEq(s.evaluate(DUMMY_AGENT_ID, 2), 500);
    }

    function test_evaluate_atTopThreshold_isFullRelease() public {
        LinearMonotonicTierStrategy s = _make();
        assertEq(s.evaluate(DUMMY_AGENT_ID, 1000), 10000);
    }

    function test_evaluate_aboveTopThreshold_saturates() public {
        LinearMonotonicTierStrategy s = _make();
        assertEq(s.evaluate(DUMMY_AGENT_ID, 1000 + 5000), 10000);
    }

    function test_evaluate_walksAllEightTiers() public {
        LinearMonotonicTierStrategy s = _make();
        uint64[8] memory probes   = [uint64(0), 1, 3, 10, 30, 100, 300, 1000];
        uint16[8] memory expected = [uint16(0), 500, 1500, 3000, 5000, 7000, 8500, 10000];
        for (uint256 i = 0; i < 8; ++i) {
            assertEq(s.evaluate(DUMMY_AGENT_ID, probes[i]), expected[i], "tier ramp mismatch");
        }
    }

    function test_evaluate_ignoresAgentId() public {
        LinearMonotonicTierStrategy s = _make();
        // Same count, two different agent ids → identical result. Encodes the
        // v1 invariant that the strategy is per-strategy not per-agent.
        assertEq(s.evaluate(1, 30),  s.evaluate(99999, 30));
        assertEq(s.evaluate(1, 30),  5000);
    }

    // ─────────────────────── Off-chain helpers ───────────────────────

    function test_thresholds_returnsExactArray() public {
        LinearMonotonicTierStrategy s = _make();
        uint64[] memory ths = s.thresholds();
        assertEq(ths.length, defaultThresholds.length);
        for (uint256 i = 0; i < ths.length; ++i) assertEq(ths[i], defaultThresholds[i]);
    }

    function test_releaseBpsArr_returnsExactArray() public {
        LinearMonotonicTierStrategy s = _make();
        uint16[] memory bps = s.releaseBpsArr();
        assertEq(bps.length, defaultBps.length);
        for (uint256 i = 0; i < bps.length; ++i) assertEq(bps[i], defaultBps[i]);
    }

    function test_config_returnsBothArraysAtomically() public {
        LinearMonotonicTierStrategy s = _make();
        (uint64[] memory ths, uint16[] memory bps) = s.config();
        assertEq(ths.length, defaultThresholds.length);
        assertEq(bps.length, defaultBps.length);
        for (uint256 i = 0; i < ths.length; ++i) {
            assertEq(ths[i], defaultThresholds[i]);
            assertEq(bps[i], defaultBps[i]);
        }
    }

    // ─────────────────────── Fuzz: monotonicity preserved across all inputs ───────────────────────

    function testFuzz_evaluate_isMonotonicNonDecreasing(uint64 a, uint64 b) public {
        LinearMonotonicTierStrategy s = _make();
        // Order the inputs so a <= b, then assert evaluate is non-decreasing.
        if (a > b) (a, b) = (b, a);
        assertLe(s.evaluate(DUMMY_AGENT_ID, a), s.evaluate(DUMMY_AGENT_ID, b));
        assertLe(s.evaluate(DUMMY_AGENT_ID, b), 10_000);
    }
}

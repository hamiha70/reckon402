// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test }            from "forge-std/Test.sol";
import { Escrow }          from "../src/Escrow.sol";
import { LinearMonotonicTierStrategy } from "../src/LinearMonotonicTierStrategy.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    MockERC20,
    MockIdentityRegistry,
    MockReputationRegistry
} from "./mocks/EscrowMocks.sol";

/// @notice Behavioural tests for the L4d Escrow contract — pluggable
///         strategy variant. Tier-curve constructor validation lives in
///         `LinearMonotonicTierStrategy.t.sol` after the L4d refactor;
///         this suite only tests Escrow-side behaviour (owner check,
///         counters, withdraw arithmetic, reentrancy).
contract EscrowTest is Test {
    MockERC20                       internal token;
    MockIdentityRegistry            internal identity;
    MockReputationRegistry          internal reputation;
    LinearMonotonicTierStrategy     internal tierStrategy;

    Escrow internal escrow;

    address internal seller            = address(0xA1);
    address internal buyer             = address(0xB2); // not owner
    address internal facilitatorClient = address(0xFAC);

    uint256 internal constant AGENT_ID = 42;
    string  internal constant TAG1     = "payment";
    string  internal constant TAG2     = "x402-settlement";

    uint64[] internal defaultThresholds;
    uint16[] internal defaultBps;

    event Withdrawn(
        address indexed by,
        uint256          amount,
        uint64           attestationCount,
        uint16           releasedBps
    );

    function setUp() public {
        token      = new MockERC20();
        identity   = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();

        identity.setOwner(AGENT_ID, seller);

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

        tierStrategy = new LinearMonotonicTierStrategy(defaultThresholds, defaultBps);

        escrow = _deploy(address(tierStrategy));
    }

    function _deploy(address strategy) internal returns (Escrow e) {
        e = new Escrow(
            token,
            address(identity),
            address(reputation),
            AGENT_ID,
            facilitatorClient,
            strategy,
            TAG1,
            TAG2
        );
    }

    function _seed(uint256 amount, uint64 attestations) internal {
        token.mint(address(escrow), amount);
        reputation.setCount(AGENT_ID, facilitatorClient, TAG1, TAG2, attestations);
    }

    // ─────────────────────── Constructor — invariants ───────────────────────

    function test_ctor_zeroToken_reverts() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new Escrow(
            MockERC20(address(0)),
            address(identity),
            address(reputation),
            AGENT_ID,
            facilitatorClient,
            address(tierStrategy),
            TAG1,
            TAG2
        );
    }

    function test_ctor_zeroIdentity_reverts() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new Escrow(
            token,
            address(0),
            address(reputation),
            AGENT_ID,
            facilitatorClient,
            address(tierStrategy),
            TAG1,
            TAG2
        );
    }

    function test_ctor_zeroReputation_reverts() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new Escrow(
            token,
            address(identity),
            address(0),
            AGENT_ID,
            facilitatorClient,
            address(tierStrategy),
            TAG1,
            TAG2
        );
    }

    function test_ctor_zeroFacilitatorClient_reverts() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new Escrow(
            token,
            address(identity),
            address(reputation),
            AGENT_ID,
            address(0),
            address(tierStrategy),
            TAG1,
            TAG2
        );
    }

    function test_ctor_zeroTierStrategy_reverts() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new Escrow(
            token,
            address(identity),
            address(reputation),
            AGENT_ID,
            facilitatorClient,
            address(0),
            TAG1,
            TAG2
        );
    }

    function test_ctor_validArgs_storesImmutables() public view {
        assertEq(address(escrow.token()),              address(token));
        assertEq(escrow.identityRegistry(),            address(identity));
        assertEq(escrow.reputationRegistry(),          address(reputation));
        assertEq(escrow.agentId(),                     AGENT_ID);
        assertEq(escrow.facilitatorClient(),           facilitatorClient);
        assertEq(escrow.tierStrategy(),                address(tierStrategy));
        assertEq(escrow.tag1(),                        TAG1);
        assertEq(escrow.tag2(),                        TAG2);
        assertEq(escrow.totalWithdrawn(),              0);
    }

    // ─────────────────────── Tier delegation ───────────────────────

    function test_releasedBps_delegatesToStrategy() public {
        // Seed the registry; assert the Escrow reports the strategy's
        // tier output verbatim.
        _seed(0, 30);
        assertEq(escrow.releasedBps(), 5000);
        assertEq(escrow.releasedBps(), tierStrategy.evaluate(AGENT_ID, 30));
    }

    function test_releasedBps_atZeroCount_isT0() public {
        _seed(0, 0);
        assertEq(escrow.releasedBps(), 0);
    }

    function test_releasedBps_atTopThreshold_isFullRelease() public {
        _seed(0, 1000);
        assertEq(escrow.releasedBps(), 10000);
    }

    function test_releasedBps_walksAllEightTiers() public {
        uint64[8] memory probes   = [uint64(0), 1, 3, 10, 30, 100, 300, 1000];
        uint16[8] memory expected = [uint16(0), 500, 1500, 3000, 5000, 7000, 8500, 10000];
        for (uint256 i = 0; i < 8; ++i) {
            reputation.setCount(AGENT_ID, facilitatorClient, TAG1, TAG2, probes[i]);
            assertEq(escrow.releasedBps(), expected[i], "tier ramp mismatch");
        }
    }

    function test_swappingStrategyForAlternateCurve_changesReleasedBps() public {
        // Deploy a second Escrow against a flatter strategy (5%/all the time);
        // attestation count is irrelevant. Demonstrates that distinct
        // Escrows on the same agent state can have different release shapes.
        uint64[] memory ths = new uint64[](1); ths[0] = 0;
        uint16[] memory bps = new uint16[](1); bps[0] = 500; // flat 5%

        LinearMonotonicTierStrategy flat = new LinearMonotonicTierStrategy(ths, bps);
        Escrow alt = _deploy(address(flat));

        token.mint(address(alt), 1_000_000);
        reputation.setCount(AGENT_ID, facilitatorClient, TAG1, TAG2, 1000);

        assertEq(alt.releasedBps(), 500, "flat strategy must override count");
        // The default-strategy Escrow at the same count returns 100%.
        _seed(0, 1000);
        assertEq(escrow.releasedBps(), 10000);
    }

    // ─────────────────────── Counter views ───────────────────────

    function test_currentlyHeld_equalsTokenBalance() public {
        _seed(1_000_000, 0); // 1 USDC (6 decimals)
        assertEq(escrow.currentlyHeld(), 1_000_000);
    }

    function test_totalDeposited_equalsBalancePlusWithdrawn() public {
        _seed(1_000_000, 1000); // T7 — 100% release
        assertEq(escrow.totalDeposited(), 1_000_000);

        vm.prank(seller);
        escrow.withdraw(400_000);

        assertEq(escrow.currentlyHeld(),  600_000);
        assertEq(escrow.totalWithdrawn(), 400_000);
        assertEq(escrow.totalDeposited(), 1_000_000); // invariant: lifetime constant under withdrawal
    }

    function test_attestationCount_passesCorrectArgs() public {
        // Seed a "wrong client" tuple that must NOT match if Escrow forwards args correctly.
        address wrongClient = address(0xDEAD);
        reputation.setCount(AGENT_ID, wrongClient, TAG1, TAG2, 999);
        // Seed the correct tuple.
        reputation.setCount(AGENT_ID, facilitatorClient, TAG1, TAG2, 7);
        // Seed a wrong-tag tuple.
        reputation.setCount(AGENT_ID, facilitatorClient, "OTHER", TAG2, 999);
        // Seed a wrong-agentId tuple.
        reputation.setCount(AGENT_ID + 1, facilitatorClient, TAG1, TAG2, 999);

        assertEq(escrow.attestationCount(), 7, "Escrow forwarded wrong args");
    }

    // ─────────────────────── Withdraw — happy path ───────────────────────

    function test_withdraw_byOwner_transfersAndUpdatesState() public {
        _seed(1_000_000, 30); // T4 — 50% release → 500_000 cap

        vm.expectEmit(true, false, false, true, address(escrow));
        emit Withdrawn(seller, 100_000, 30, 5000);

        uint256 sellerBalBefore = token.balanceOf(seller);
        vm.prank(seller);
        escrow.withdraw(100_000);

        assertEq(token.balanceOf(seller) - sellerBalBefore, 100_000);
        assertEq(escrow.totalWithdrawn(),                   100_000);
        assertEq(escrow.currentlyHeld(),                    900_000);
        assertEq(escrow.withdrawableNow(),                  400_000); // 500_000 - 100_000
    }

    function test_withdrawAll_drainsCurrentReleased() public {
        _seed(1_000_000, 30); // 50% release

        uint256 expected = 500_000;
        vm.prank(seller);
        uint256 amount = escrow.withdrawAll();

        assertEq(amount,                   expected);
        assertEq(token.balanceOf(seller),  expected);
        assertEq(escrow.totalWithdrawn(),  expected);
        assertEq(escrow.withdrawableNow(), 0);
    }

    function test_withdrawAll_consumesAtNoOpWhenAlreadyDrained() public {
        _seed(1_000_000, 30);
        vm.prank(seller); escrow.withdrawAll();

        // Second pull at same tier — nothing left.
        vm.prank(seller);
        vm.expectRevert(Escrow.NothingToWithdraw.selector);
        escrow.withdrawAll();
    }

    function test_tierUpgrade_unlocksMore() public {
        _seed(1_000_000, 30); // 50% release

        vm.prank(seller); uint256 round1 = escrow.withdrawAll();
        assertEq(round1, 500_000);

        // Tier ratchet: count climbs into T5 (100 → 70%).
        reputation.setCount(AGENT_ID, facilitatorClient, TAG1, TAG2, 100);
        // releasedAmount = totalDeposited * 7000/10000 = 700_000
        // withdrawableNow = 700_000 - 500_000 = 200_000
        assertEq(escrow.withdrawableNow(), 200_000);

        vm.prank(seller); uint256 round2 = escrow.withdrawAll();
        assertEq(round2, 200_000);
        assertEq(escrow.totalWithdrawn(), 700_000);
    }

    // ─────────────────────── Withdraw — rejection ───────────────────────

    function test_withdraw_byNonOwner_reverts() public {
        _seed(1_000_000, 1000);
        vm.prank(buyer);
        vm.expectRevert(Escrow.NotOwner.selector);
        escrow.withdraw(100_000);
    }

    function test_withdrawAll_byNonOwner_reverts() public {
        _seed(1_000_000, 1000);
        vm.prank(buyer);
        vm.expectRevert(Escrow.NotOwner.selector);
        escrow.withdrawAll();
    }

    function test_withdraw_zero_reverts() public {
        _seed(1_000_000, 1000);
        vm.prank(seller);
        vm.expectRevert(Escrow.NothingToWithdraw.selector);
        escrow.withdraw(0);
    }

    function test_withdraw_aboveAvailable_reverts() public {
        _seed(1_000_000, 30); // 500_000 available
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                Escrow.WithdrawAmountExceedsAvailable.selector,
                500_001,
                500_000
            )
        );
        escrow.withdraw(500_001);
    }

    function test_withdraw_atT0_reverts() public {
        _seed(1_000_000, 0); // T0 → 0 release
        vm.prank(seller);
        vm.expectRevert(Escrow.NothingToWithdraw.selector);
        escrow.withdrawAll();
    }

    function test_nftTransfer_changesAuthority() public {
        _seed(1_000_000, 30); // 500_000 available

        // Seller withdraws half their entitlement.
        vm.prank(seller); escrow.withdraw(200_000);
        assertEq(escrow.totalWithdrawn(), 200_000);

        // Agent NFT transfers to a new owner.
        address newOwner = address(0xC3);
        identity.setOwner(AGENT_ID, newOwner);

        // Old owner can no longer withdraw.
        vm.prank(seller);
        vm.expectRevert(Escrow.NotOwner.selector);
        escrow.withdrawAll();

        // New owner can drain the rest (300_000 left).
        vm.prank(newOwner);
        uint256 pulled = escrow.withdrawAll();
        assertEq(pulled,                       300_000);
        assertEq(token.balanceOf(newOwner),    300_000);
        assertEq(token.balanceOf(seller),      200_000); // earlier draws stay with seller
        assertEq(escrow.totalWithdrawn(),      500_000);
    }

    // ─────────────────────── Reentrancy ───────────────────────

    function test_withdraw_reentry_revertsViaGuard() public {
        _seed(1_000_000, 1000); // 100% release

        // Configure the mock token to re-enter Escrow.withdraw on every transfer.
        token.setReentryTarget(address(escrow), 1);

        vm.prank(seller);
        // OZ v5 ReentrancyGuard reverts with ReentrancyGuardReentrantCall().
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        escrow.withdraw(100_000);
    }

    // ─────────────────────── Off-chain helpers ───────────────────────

    function test_getStats_returnsAllSeven() public {
        _seed(2_000_000, 30); // T4 → 50%

        (
            uint256 totalDep,
            uint256 currentlyHeld_,
            uint256 totalW,
            uint256 releasedAmt,
            uint256 withdrawableAmt,
            uint64  attestations,
            uint16  bps
        ) = escrow.getStats();

        assertEq(totalDep,         2_000_000);
        assertEq(currentlyHeld_,   2_000_000);
        assertEq(totalW,           0);
        assertEq(releasedAmt,      1_000_000); // 50% of 2M
        assertEq(withdrawableAmt,  1_000_000);
        assertEq(attestations,     30);
        assertEq(bps,              5000);

        vm.prank(seller); escrow.withdraw(700_000);

        (
            totalDep,
            currentlyHeld_,
            totalW,
            releasedAmt,
            withdrawableAmt,
            attestations,
            bps
        ) = escrow.getStats();
        assertEq(totalDep,         2_000_000);    // lifetime invariant
        assertEq(currentlyHeld_,   1_300_000);    // 2M - 700k
        assertEq(totalW,           700_000);
        assertEq(releasedAmt,      1_000_000);
        assertEq(withdrawableAmt,  300_000);      // 1M - 700k
    }
}

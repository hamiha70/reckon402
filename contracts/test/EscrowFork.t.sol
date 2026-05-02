// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Splitter }                     from "../src/Splitter.sol";
import { SplitterFactory }              from "../src/SplitterFactory.sol";
import { Escrow }                       from "../src/Escrow.sol";
import { EscrowFactory }                from "../src/EscrowFactory.sol";
import { LinearMonotonicTierStrategy }  from "../src/LinearMonotonicTierStrategy.sol";

/// @dev End-to-end fork test for the L4d on-chain Escrow flow against real
///      Base Sepolia state. Exercises the FULL trust path:
///        1. Real USDC contract on Base Sepolia (transferWithAuthorization)
///        2. Real IdentityRegistry on Base Sepolia (register() / ownerOf())
///        3. Real ReputationRegistry on Base Sepolia (giveFeedback() / getSummary())
///        4. Our deployed factories OR freshly-deployed factories on the fork
///
///      Three test scenarios:
///
///      A. `test_forkE2E_freshDeployAndTierWalk` — full fresh deploy, real
///         registries. Registers a new agent via IdentityRegistry, deploys a
///         per-agent Escrow + TierStrategy + Splitter via factories, sends
///         USDC, distributes, walks tiers via real giveFeedback() calls,
///         withdraws as NFT owner. Proves the architecture composes against
///         live registry contracts (not just our mocks).
///
///      B. `test_forkSanity_seller11LiveEscrow` — read-only verification of
///         the actually-deployed seller11 Escrow at 0x863d2105...; confirms
///         its getStats() shape lines up with TierStrategy.evaluate() for the
///         live attestation count. Catches drift between deployed bytecode
///         and current source.
///
///      C. `test_forkSanity_factoryImmutables` — read-only verification of
///         the deployed EscrowFactory's immutable state (token,
///         identityRegistry, reputationRegistry). Catches accidental
///         re-deployment or wrong-chain mishaps.
///
///      Gated on env var L4D_FORK_TEST=1; otherwise skipped to keep the
///      default `forge test` run offline. When the gate is off, every test
///      body short-circuits with an emit log + return; the suite reports
///      PASS for compatibility with the existing CI gate.
///
///      Run:
///        L4D_FORK_TEST=1 \
///        BASE_SEPOLIA_RPC_PRIMARY=https://... \
///        forge test --fork-url base_sepolia \
///                   --match-contract EscrowForkTest -vv
contract EscrowForkTest is Test {
    // --- Pinned Base Sepolia addresses (chainId 84532) -----------------
    IERC20  constant USDC             = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    address constant IDENTITY         = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION       = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    // Live deployed L4d artifacts (seller11) — read-only sanity surface.
    EscrowFactory   constant LIVE_ESCROW_FACTORY  = EscrowFactory(0xb06998682BD716e0864257b3AC3AA1fc4cc64589);
    address         constant LIVE_TIER_STRATEGY   = 0xc498155bC4A2E4Ba979Ad5797298107c63B26C4e;
    Escrow          constant LIVE_SELLER11_ESCROW = Escrow(0x863d2105B57Cb98129B68b934FF5708DC9432aAA);
    uint256         constant LIVE_SELLER11_AGENT_ID = 5423;
    address         constant LIVE_FACILITATOR_EOA = 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455;
    address         constant LIVE_SELLER11_OWNER  = 0xD53ffac42496d73B3Faf946786688a8454F57b1f;

    // --- Test-local actors (only used in fresh-deploy scenario) -------
    address internal facilitator;
    address internal nftOwner;
    address internal randoCaller;

    // --- Fresh-deploy scenario state -----------------------------------
    LinearMonotonicTierStrategy internal strategy;
    EscrowFactory               internal factory;
    Escrow                      internal escrow;
    Splitter                    internal splitter;
    uint256                     internal agentId;

    function setUp() public {
        if (!_forkEnabled()) return;

        facilitator = makeAddr("facilitator-fork");
        nftOwner    = makeAddr("nft-owner-fork");
        randoCaller = makeAddr("rando-fork");
    }

    // ─── A. Full fresh deploy + tier walk ────────────────────────────
    function test_forkE2E_freshDeployAndTierWalk() public {
        if (!_forkEnabled()) { emit log("skipped: L4D_FORK_TEST not set"); return; }

        // Step 1: register a new agent on the real IdentityRegistry. The
        // registering address (`nftOwner` after vm.prank) becomes the NFT
        // owner of the freshly-minted agentId.
        vm.startPrank(nftOwner);
        (bool ok, bytes memory ret) = IDENTITY.call(
            abi.encodeWithSignature("register()")
        );
        vm.stopPrank();
        require(ok, "IdentityRegistry.register() failed on fork");
        agentId = abi.decode(ret, (uint256));
        assertGt(agentId, 0, "agentId minted");
        assertEq(_ownerOf(agentId), nftOwner, "NFT owner == prank caller");

        // Step 2: deploy fresh tier strategy with the canonical v1 curve
        // [0,1,3,10,30,100,300,1000] → [0,500,1500,3000,5000,7000,8500,10000].
        uint64[] memory thresholds = new uint64[](8);
        uint16[] memory releases   = new uint16[](8);
        thresholds[0]=0;    releases[0]=0;
        thresholds[1]=1;    releases[1]=500;
        thresholds[2]=3;    releases[2]=1500;
        thresholds[3]=10;   releases[3]=3000;
        thresholds[4]=30;   releases[4]=5000;
        thresholds[5]=100;  releases[5]=7000;
        thresholds[6]=300;  releases[6]=8500;
        thresholds[7]=1000; releases[7]=10000;
        strategy = new LinearMonotonicTierStrategy(thresholds, releases);

        // Step 3: deploy fresh EscrowFactory pointing at REAL Base Sepolia
        // identity + reputation registries.
        factory = new EscrowFactory(USDC, IDENTITY, REPUTATION);
        assertEq(address(factory.token()), address(USDC));
        assertEq(factory.identityRegistry(), IDENTITY);
        assertEq(factory.reputationRegistry(), REPUTATION);

        // Step 4: deploy per-agent Escrow.
        bytes32 escrowSalt = keccak256(abi.encodePacked("EscrowForkTest", agentId));
        address escrowAddr = factory.createEscrow(
            agentId,
            facilitator,
            address(strategy),
            "payment",
            "x402-settlement",
            escrowSalt
        );
        escrow = Escrow(escrowAddr);
        assertTrue(factory.isDeployed(escrowAddr));
        assertEq(factory.escrowOfAgent(agentId), escrowAddr);

        // Step 5: build + deploy a 3-recipient Splitter (87/3/10) via direct
        // construction (we don't need SplitterFactory in this scope — its
        // own fork test lives in SplitterFork.t.sol).
        address[] memory recipients = new address[](3);
        recipients[0] = nftOwner;       // seller payout — maps to NFT owner here
        recipients[1] = facilitator;    // facilitator fee
        recipients[2] = escrowAddr;     // per-agent Escrow
        uint16[] memory bps = new uint16[](3);
        bps[0] = 8700; bps[1] = 300; bps[2] = 1000;
        splitter = new Splitter(USDC, recipients, bps);

        // Step 6: fund the Splitter with 0.10 USDC via deal() (skip the
        // EIP-3009 dance — that's covered by SplitterFork.t.sol).
        uint256 payment = 100_000;            // 0.10 USDC base units
        deal(address(USDC), address(splitter), payment);
        assertEq(USDC.balanceOf(address(splitter)), payment);

        // Step 7: distribute. Escrow should receive 10% (10_000 atomic).
        bytes32 paymentId = keccak256(abi.encode("fork-fresh-deploy", agentId));
        splitter.distribute(paymentId, payment);

        uint256 expectedEscrow = (payment * 1000) / 10000; // 10%
        assertEq(USDC.balanceOf(escrowAddr), expectedEscrow, "escrow received 10%");
        assertEq(escrow.totalDeposited(), expectedEscrow);
        assertEq(escrow.currentlyHeld(), expectedEscrow);

        // Step 8: with zero attestations, releasedBps must be T0 = 0.
        assertEq(escrow.attestationCount(), 0);
        assertEq(escrow.releasedBps(), 0);
        assertEq(escrow.releasedAmount(), 0);
        assertEq(escrow.withdrawableNow(), 0);

        // Step 9: simulate a single facilitator-signed attestation. This
        // hits the REAL ReputationRegistry on the fork; the call's msg.sender
        // == facilitator EOA (via vm.prank), so the resulting NewFeedback
        // event records `clientAddress = facilitator` — exactly what our
        // Escrow's getSummary filter expects.
        _giveFacilitatorFeedback(agentId, "first attestation");
        assertEq(escrow.attestationCount(), 1, "T1 threshold reached");
        assertEq(escrow.releasedBps(), 500,   "T1 = 5% release");

        // Step 10: walk to T2 (3 attestations).
        _giveFacilitatorFeedback(agentId, "second");
        _giveFacilitatorFeedback(agentId, "third");
        assertEq(escrow.attestationCount(), 3,    "T2 threshold reached");
        assertEq(escrow.releasedBps(), 1500,      "T2 = 15% release");

        // Step 11: withdraw — only NFT owner may pull.
        vm.startPrank(randoCaller);
        vm.expectRevert(Escrow.NotOwner.selector);
        escrow.withdrawAll();
        vm.stopPrank();

        uint256 expectedReleased  = (expectedEscrow * 1500) / 10000; // 15%
        uint256 ownerBalanceBefore = USDC.balanceOf(nftOwner);

        vm.startPrank(nftOwner);
        escrow.withdrawAll();
        vm.stopPrank();

        // The fresh nftOwner address has no other USDC, so the delta IS the
        // release. (We don't use deal() on nftOwner; the Splitter's slot 0
        // payout went to the same address so balance check is delta-aware.)
        uint256 ownerBalanceAfter = USDC.balanceOf(nftOwner);
        assertEq(
            ownerBalanceAfter - ownerBalanceBefore,
            expectedReleased,
            "T2 released amount transferred to NFT owner"
        );
        assertEq(escrow.totalWithdrawn(), expectedReleased);
        assertEq(escrow.currentlyHeld(), expectedEscrow - expectedReleased);
        assertEq(escrow.withdrawableNow(), 0, "drained to current ceiling");

        // Step 12: walking further (to T3 at 10 attestations) unlocks more.
        for (uint256 i = 0; i < 7; ++i) {
            _giveFacilitatorFeedback(agentId, string(abi.encodePacked("walk-", vm.toString(i))));
        }
        assertEq(escrow.attestationCount(), 10);
        assertEq(escrow.releasedBps(), 3000);
        uint256 expectedT3Released   = (expectedEscrow * 3000) / 10000;
        uint256 expectedT3Additional = expectedT3Released - expectedReleased;
        assertEq(escrow.withdrawableNow(), expectedT3Additional, "T3 additional unlocked");

        vm.startPrank(nftOwner);
        escrow.withdrawAll();
        vm.stopPrank();

        assertEq(escrow.totalWithdrawn(), expectedT3Released, "cumulative T3 release");
        assertEq(escrow.currentlyHeld(), expectedEscrow - expectedT3Released);
    }

    // ─── B. Read-only sanity vs the seller11 live Escrow ─────────────
    function test_forkSanity_seller11LiveEscrow() public {
        if (!_forkEnabled()) { emit log("skipped: L4D_FORK_TEST not set"); return; }

        // Cold sanity on the deployed Escrow's immutables.
        assertEq(address(LIVE_SELLER11_ESCROW.token()),       address(USDC));
        assertEq(LIVE_SELLER11_ESCROW.identityRegistry(),     IDENTITY);
        assertEq(LIVE_SELLER11_ESCROW.reputationRegistry(),   REPUTATION);
        assertEq(LIVE_SELLER11_ESCROW.agentId(),              LIVE_SELLER11_AGENT_ID);
        assertEq(LIVE_SELLER11_ESCROW.facilitatorClient(),    LIVE_FACILITATOR_EOA);
        assertEq(LIVE_SELLER11_ESCROW.tierStrategy(),         LIVE_TIER_STRATEGY);

        // The NFT owner is whoever currently holds agentId=5423 on Base Sepolia.
        // At deploy time it was 0xD53ffac4...; if it transferred since,
        // ownerOf-anchored authority moved with it (intended design).
        address liveOwner = LIVE_SELLER11_ESCROW.owner();
        assertTrue(liveOwner != address(0), "agent NFT exists");

        // Cross-check tier evaluation: TierStrategy.evaluate(agentId, count)
        // must return the same value the Escrow's releasedBps() returns.
        uint64 count = LIVE_SELLER11_ESCROW.attestationCount();
        uint16 strategyBps = LinearMonotonicTierStrategy(LIVE_TIER_STRATEGY)
            .evaluate(LIVE_SELLER11_AGENT_ID, count);
        assertEq(LIVE_SELLER11_ESCROW.releasedBps(), strategyBps,
            "Escrow.releasedBps == TierStrategy.evaluate");

        // Invariant: held + withdrawn == deposited.
        assertEq(
            LIVE_SELLER11_ESCROW.currentlyHeld() + LIVE_SELLER11_ESCROW.totalWithdrawn(),
            LIVE_SELLER11_ESCROW.totalDeposited(),
            "invariant: held + withdrawn == deposited"
        );

        // Invariant: withdrawn <= released.
        assertLe(
            LIVE_SELLER11_ESCROW.totalWithdrawn(),
            LIVE_SELLER11_ESCROW.releasedAmount(),
            "withdrawn never exceeds released"
        );
    }

    // ─── C. Read-only sanity vs the deployed EscrowFactory ────────────
    function test_forkSanity_factoryImmutables() public {
        if (!_forkEnabled()) { emit log("skipped: L4D_FORK_TEST not set"); return; }

        assertEq(address(LIVE_ESCROW_FACTORY.token()), address(USDC));
        assertEq(LIVE_ESCROW_FACTORY.identityRegistry(), IDENTITY);
        assertEq(LIVE_ESCROW_FACTORY.reputationRegistry(), REPUTATION);

        // The seller11 Escrow MUST be tagged isDeployed by this factory.
        assertTrue(
            LIVE_ESCROW_FACTORY.isDeployed(address(LIVE_SELLER11_ESCROW)),
            "factory acknowledges seller11 Escrow"
        );
        assertEq(
            LIVE_ESCROW_FACTORY.escrowOfAgent(LIVE_SELLER11_AGENT_ID),
            address(LIVE_SELLER11_ESCROW),
            "agent->escrow mapping correct"
        );

        // The pinned tier strategy must accept the v1 curve we expect.
        // Walk a representative subset of the threshold table so a strategy
        // swap (e.g. accidental redeploy) would surface here immediately.
        LinearMonotonicTierStrategy ts = LinearMonotonicTierStrategy(LIVE_TIER_STRATEGY);
        assertEq(ts.evaluate(0, 0),    0,     "T0 floor");
        assertEq(ts.evaluate(0, 1),    500,   "T1");
        assertEq(ts.evaluate(0, 3),    1500,  "T2");
        assertEq(ts.evaluate(0, 10),   3000,  "T3");
        assertEq(ts.evaluate(0, 30),   5000,  "T4");
        assertEq(ts.evaluate(0, 100),  7000,  "T5");
        assertEq(ts.evaluate(0, 300),  8500,  "T6");
        assertEq(ts.evaluate(0, 1000), 10000, "T7 ceiling");
        assertEq(ts.evaluate(0, 9999), 10000, "saturation above T7");
    }

    // ─── helpers ──────────────────────────────────────────────────────
    function _forkEnabled() internal view returns (bool) {
        try vm.envBool("L4D_FORK_TEST") returns (bool on) {
            return on;
        } catch {
            return false;
        }
    }

    function _ownerOf(uint256 id) internal view returns (address) {
        (bool ok, bytes memory ret) = IDENTITY.staticcall(
            abi.encodeWithSignature("ownerOf(uint256)", id)
        );
        require(ok, "ownerOf failed");
        return abi.decode(ret, (address));
    }

    /// @dev vm.prank as `facilitator` and write a feedback row to the real
    ///      ReputationRegistry. The on-chain `clientAddress` recorded in the
    ///      NewFeedback event equals `msg.sender` (the EVM doesn't let you
    ///      lie), which the Escrow's getSummary filter relies on.
    function _giveFacilitatorFeedback(uint256 id, string memory feedbackURI) internal {
        vm.startPrank(facilitator);
        (bool ok, ) = REPUTATION.call(
            abi.encodeWithSignature(
                "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
                id,
                int128(100),                  // value: positive
                uint8(2),                     // valueDecimals: 2 → 1.00
                "payment",                    // tag1
                "x402-settlement",            // tag2
                "",                           // endpoint
                feedbackURI,                  // feedbackURI
                bytes32(0)                    // feedbackHash (deterministic v1.5)
            )
        );
        vm.stopPrank();
        require(ok, "giveFeedback failed on fork");
    }
}

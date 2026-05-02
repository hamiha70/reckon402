// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test }            from "forge-std/Test.sol";
import { Escrow }          from "../src/Escrow.sol";
import { EscrowFactory }   from "../src/EscrowFactory.sol";

import {
    MockERC20,
    MockIdentityRegistry,
    MockReputationRegistry
} from "./mocks/EscrowMocks.sol";

contract EscrowFactoryTest is Test {
    MockERC20              internal token;
    MockIdentityRegistry   internal identity;
    MockReputationRegistry internal reputation;

    EscrowFactory internal factory;

    address internal facilitatorClient = address(0xFAC);

    uint64[] internal defaultThresholds;
    uint16[] internal defaultBps;

    string  internal constant TAG1 = "payment";
    string  internal constant TAG2 = "x402-settlement";

    event EscrowCreated(
        uint256 indexed agentId,
        address indexed escrow,
        bytes32 indexed salt,
        address          facilitatorClient,
        uint64[]         tierThresholds,
        uint16[]         tierReleaseBps,
        string           tag1,
        string           tag2
    );

    function setUp() public {
        token      = new MockERC20();
        identity   = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();

        factory = new EscrowFactory(
            token,
            address(identity),
            address(reputation)
        );

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

    // ─────────────────────── Constructor — invariants ───────────────────────

    function test_ctor_zeroToken_reverts() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(MockERC20(address(0)), address(identity), address(reputation));
    }

    function test_ctor_zeroIdentity_reverts() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(token, address(0), address(reputation));
    }

    function test_ctor_zeroReputation_reverts() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(token, address(identity), address(0));
    }

    function test_ctor_immutablesStored() public view {
        assertEq(address(factory.token()),       address(token));
        assertEq(factory.identityRegistry(),     address(identity));
        assertEq(factory.reputationRegistry(),   address(reputation));
    }

    // ─────────────────────── createEscrow — happy path ───────────────────────

    function test_createEscrow_happyPath_deploysAtPredicted() public {
        bytes32 salt = keccak256("seller10");
        uint256 agentId = 9001;

        address predicted = factory.predictAddress(
            agentId, facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2, salt
        );

        // Emit-shape assertion on the EscrowCreated event.
        vm.expectEmit(true, true, true, true, address(factory));
        emit EscrowCreated(
            agentId, predicted, salt,
            facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2
        );

        address escrowAddr = factory.createEscrow(
            agentId, facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2, salt
        );

        assertEq(escrowAddr, predicted, "escrow != predicted");

        assertTrue(factory.isDeployed(escrowAddr), "isDeployed not set");
        assertEq(factory.escrowOfAgent(agentId), escrowAddr, "escrowOfAgent not set");

        // Verify the deployed Escrow has the expected immutables.
        Escrow esc = Escrow(escrowAddr);
        assertEq(esc.agentId(),                agentId);
        assertEq(esc.facilitatorClient(),      facilitatorClient);
        assertEq(esc.identityRegistry(),       address(identity));
        assertEq(esc.reputationRegistry(),     address(reputation));
        assertEq(address(esc.token()),         address(token));
    }

    function test_predictAddress_matchesActualDeploy() public {
        bytes32 salt = bytes32(uint256(0xDEAD));
        uint256 agentId = 7;

        address predicted = factory.predictAddress(
            agentId, facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2, salt
        );
        address deployed = factory.createEscrow(
            agentId, facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2, salt
        );
        assertEq(predicted, deployed, "CREATE2 prediction drift");
    }

    function test_createEscrow_twoDifferentAgents_deployIndependently() public {
        bytes32 saltA = keccak256("a");
        bytes32 saltB = keccak256("b");

        address a = factory.createEscrow(
            1, facilitatorClient, defaultThresholds, defaultBps, TAG1, TAG2, saltA
        );
        address b = factory.createEscrow(
            2, facilitatorClient, defaultThresholds, defaultBps, TAG1, TAG2, saltB
        );

        assertTrue(a != b, "two agents should get distinct escrows");
        assertTrue(factory.isDeployed(a));
        assertTrue(factory.isDeployed(b));
        assertEq(factory.escrowOfAgent(1), a);
        assertEq(factory.escrowOfAgent(2), b);
    }

    // ─────────────────────── createEscrow — duplicate handling ───────────────────────

    function test_createEscrow_duplicateAgentId_reverts() public {
        bytes32 saltA = keccak256("a");
        bytes32 saltB = keccak256("b");

        factory.createEscrow(
            1, facilitatorClient, defaultThresholds, defaultBps, TAG1, TAG2, saltA
        );
        vm.expectRevert(
            abi.encodeWithSelector(EscrowFactory.AlreadyDeployedForAgent.selector, uint256(1))
        );
        factory.createEscrow(
            1, facilitatorClient, defaultThresholds, defaultBps, TAG1, TAG2, saltB
        );
    }

    function test_createEscrow_invalidTierLengths_bubblesEscrowRevert() public {
        uint64[] memory ths = new uint64[](2); ths[0] = 0; ths[1] = 1;
        uint16[] memory bps = new uint16[](3); bps[0] = 0; bps[1] = 500; bps[2] = 1000;

        vm.expectRevert(Escrow.TierLengthsMismatch.selector);
        factory.createEscrow(1, facilitatorClient, ths, bps, TAG1, TAG2, bytes32(uint256(1)));
    }

    function test_createEscrow_decreasingBps_bubblesEscrowRevert() public {
        uint64[] memory ths = new uint64[](3); ths[0] = 0; ths[1] = 1; ths[2] = 2;
        uint16[] memory bps = new uint16[](3); bps[0] = 1000; bps[1] = 500; bps[2] = 1500;

        vm.expectRevert(Escrow.TierBpsNotMonotonic.selector);
        factory.createEscrow(1, facilitatorClient, ths, bps, TAG1, TAG2, bytes32(uint256(2)));
    }

    function test_createEscrow_zeroFacilitatorClient_bubblesEscrowRevert() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        factory.createEscrow(
            1, address(0), defaultThresholds, defaultBps, TAG1, TAG2, bytes32(uint256(3))
        );
    }

    // ─────────────────────── isDeployed defaults ───────────────────────

    function test_isDeployed_defaultsFalseForUnknownAddress() public view {
        assertFalse(factory.isDeployed(address(0xDEADBEEF)));
        assertFalse(factory.isDeployed(address(this)));
        assertFalse(factory.isDeployed(address(factory)));
    }

    function test_escrowOfAgent_defaultsZeroAddressForUnknownAgent() public view {
        assertEq(factory.escrowOfAgent(0), address(0));
        assertEq(factory.escrowOfAgent(99999999), address(0));
    }

    // ─────────────────────── Fuzz on salt ───────────────────────

    function testFuzz_predictAddress_matchesDeploy(bytes32 salt, uint8 agentIdSeed) public {
        uint256 agentId = uint256(agentIdSeed) + 1;
        address predicted = factory.predictAddress(
            agentId, facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2, salt
        );
        address deployed = factory.createEscrow(
            agentId, facilitatorClient,
            defaultThresholds, defaultBps,
            TAG1, TAG2, salt
        );
        assertEq(predicted, deployed, "CREATE2 prediction drift (fuzz)");
        assertTrue(factory.isDeployed(deployed));
    }
}

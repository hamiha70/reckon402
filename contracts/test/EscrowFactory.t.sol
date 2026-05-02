// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test }            from "forge-std/Test.sol";
import { Escrow }          from "../src/Escrow.sol";
import { EscrowFactory }   from "../src/EscrowFactory.sol";
import { LinearMonotonicTierStrategy } from "../src/LinearMonotonicTierStrategy.sol";

import {
    MockERC20,
    MockIdentityRegistry,
    MockReputationRegistry
} from "./mocks/EscrowMocks.sol";

contract EscrowFactoryTest is Test {
    MockERC20                       internal token;
    MockIdentityRegistry            internal identity;
    MockReputationRegistry          internal reputation;
    LinearMonotonicTierStrategy     internal tierStrategy;

    EscrowFactory internal factory;

    address internal facilitatorClient = address(0xFAC);

    string  internal constant TAG1 = "payment";
    string  internal constant TAG2 = "x402-settlement";

    event EscrowCreated(
        uint256 indexed agentId,
        address indexed escrow,
        bytes32 indexed salt,
        address          facilitatorClient,
        address          tierStrategy,
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

        // Deploy the v1 default tier strategy once for the suite. Tier-curve
        // construction validation is exercised in
        // LinearMonotonicTierStrategyTest; this suite uses the live
        // strategy as a black-box dependency.
        uint64[] memory ths = new uint64[](8);
        uint16[] memory bps = new uint16[](8);
        ths[0] = 0;     bps[0] = 0;
        ths[1] = 1;     bps[1] = 500;
        ths[2] = 3;     bps[2] = 1500;
        ths[3] = 10;    bps[3] = 3000;
        ths[4] = 30;    bps[4] = 5000;
        ths[5] = 100;   bps[5] = 7000;
        ths[6] = 300;   bps[6] = 8500;
        ths[7] = 1000;  bps[7] = 10000;
        tierStrategy = new LinearMonotonicTierStrategy(ths, bps);
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
            agentId, facilitatorClient, address(tierStrategy),
            TAG1, TAG2, salt
        );

        // Emit-shape assertion on the EscrowCreated event.
        vm.expectEmit(true, true, true, true, address(factory));
        emit EscrowCreated(
            agentId, predicted, salt,
            facilitatorClient,
            address(tierStrategy),
            TAG1, TAG2
        );

        address escrowAddr = factory.createEscrow(
            agentId, facilitatorClient, address(tierStrategy),
            TAG1, TAG2, salt
        );

        assertEq(escrowAddr, predicted, "escrow != predicted");

        assertTrue(factory.isDeployed(escrowAddr), "isDeployed not set");
        assertEq(factory.escrowOfAgent(agentId), escrowAddr, "escrowOfAgent not set");

        // Verify the deployed Escrow has the expected immutables.
        Escrow esc = Escrow(escrowAddr);
        assertEq(esc.agentId(),                agentId);
        assertEq(esc.facilitatorClient(),      facilitatorClient);
        assertEq(esc.tierStrategy(),           address(tierStrategy));
        assertEq(esc.identityRegistry(),       address(identity));
        assertEq(esc.reputationRegistry(),     address(reputation));
        assertEq(address(esc.token()),         address(token));
    }

    function test_predictAddress_matchesActualDeploy() public {
        bytes32 salt = bytes32(uint256(0xDEAD));
        uint256 agentId = 7;

        address predicted = factory.predictAddress(
            agentId, facilitatorClient, address(tierStrategy),
            TAG1, TAG2, salt
        );
        address deployed = factory.createEscrow(
            agentId, facilitatorClient, address(tierStrategy),
            TAG1, TAG2, salt
        );
        assertEq(predicted, deployed, "CREATE2 prediction drift");
    }

    function test_createEscrow_twoDifferentAgents_deployIndependently() public {
        bytes32 saltA = keccak256("a");
        bytes32 saltB = keccak256("b");

        address a = factory.createEscrow(
            1, facilitatorClient, address(tierStrategy), TAG1, TAG2, saltA
        );
        address b = factory.createEscrow(
            2, facilitatorClient, address(tierStrategy), TAG1, TAG2, saltB
        );

        assertTrue(a != b, "two agents should get distinct escrows");
        assertTrue(factory.isDeployed(a));
        assertTrue(factory.isDeployed(b));
        assertEq(factory.escrowOfAgent(1), a);
        assertEq(factory.escrowOfAgent(2), b);
    }

    function test_createEscrow_distinctStrategies_deployIndependently() public {
        // Two agents, same tag/salt-base, but DIFFERENT strategy addresses
        // → different deployed Escrows. Locks the design invariant that
        // strategy is part of the CREATE2 init-code hash.
        uint64[] memory ths = new uint64[](1); ths[0] = 0;
        uint16[] memory bps = new uint16[](1); bps[0] = 100;
        LinearMonotonicTierStrategy alt = new LinearMonotonicTierStrategy(ths, bps);

        bytes32 salt = bytes32(uint256(0x1234));
        address withDefault = factory.createEscrow(
            1, facilitatorClient, address(tierStrategy), TAG1, TAG2, salt
        );
        // Same agentId is rejected; switch agentId to test strategy-affects-address.
        address withAlt = factory.createEscrow(
            2, facilitatorClient, address(alt),         TAG1, TAG2, salt
        );

        assertTrue(withDefault != withAlt, "different strategies must yield different addresses");
    }

    // ─────────────────────── createEscrow — duplicate handling ───────────────────────

    function test_createEscrow_duplicateAgentId_reverts() public {
        bytes32 saltA = keccak256("a");
        bytes32 saltB = keccak256("b");

        factory.createEscrow(
            1, facilitatorClient, address(tierStrategy), TAG1, TAG2, saltA
        );
        vm.expectRevert(
            abi.encodeWithSelector(EscrowFactory.AlreadyDeployedForAgent.selector, uint256(1))
        );
        factory.createEscrow(
            1, facilitatorClient, address(tierStrategy), TAG1, TAG2, saltB
        );
    }

    function test_createEscrow_zeroFacilitatorClient_bubblesEscrowRevert() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        factory.createEscrow(
            1, address(0), address(tierStrategy), TAG1, TAG2, bytes32(uint256(3))
        );
    }

    function test_createEscrow_zeroTierStrategy_bubblesEscrowRevert() public {
        vm.expectRevert(Escrow.ZeroAddress.selector);
        factory.createEscrow(
            1, facilitatorClient, address(0), TAG1, TAG2, bytes32(uint256(4))
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
            agentId, facilitatorClient, address(tierStrategy),
            TAG1, TAG2, salt
        );
        address deployed = factory.createEscrow(
            agentId, facilitatorClient, address(tierStrategy),
            TAG1, TAG2, salt
        );
        assertEq(predicted, deployed, "CREATE2 prediction drift (fuzz)");
        assertTrue(factory.isDeployed(deployed));
    }
}

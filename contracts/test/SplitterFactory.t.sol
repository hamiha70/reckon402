// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { SplitterFactory } from "../src/SplitterFactory.sol";
import { Splitter } from "../src/Splitter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function transfer(address to, uint256 v) external override returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }
    function approve(address s, uint256 v) external override returns (bool) {
        allowance[msg.sender][s] = v;
        emit Approval(msg.sender, s, v);
        return true;
    }
    function transferFrom(address f, address t, uint256 v) external override returns (bool) {
        allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[t] += v;
        emit Transfer(f, t, v);
        return true;
    }
}

contract SplitterFactoryTest is Test {
    MockERC20 internal token;
    SplitterFactory internal factory;

    address internal sellingAgent = address(0xA1);
    address internal platform     = address(0xB0);
    address internal treasury     = address(0xC0);

    event SplitterCreated(
        address indexed sellingAgent,
        address indexed splitter,
        bytes32 indexed salt,
        address[]       recipients,
        uint16[]        bps
    );

    function setUp() public {
        token   = new MockERC20();
        factory = new SplitterFactory(token);
    }

    // ─────────────────────── Case 1: happy path ───────────────────────

    function test_createSplitter_happyPath_deploysAndRecords() public {
        address[] memory recips = _twoRecips(sellingAgent, platform);
        uint16[]  memory bps    = _twoBps(9_500, 500);
        bytes32 salt = keccak256("happy-path");

        address predicted = factory.predictAddress(salt, recips, bps);

        // Emit-shape assertion on the exact event + args.
        vm.expectEmit(true, true, true, true, address(factory));
        emit SplitterCreated(sellingAgent, predicted, salt, recips, bps);

        address splitter = factory.createSplitter(sellingAgent, recips, bps, salt);

        // Deployed address matches CREATE2 prediction.
        assertEq(splitter, predicted, "splitter != predicted");
        // Factory records the deployment.
        assertTrue(factory.isDeployed(splitter), "isDeployed not set");
        // Deployed Splitter has the right shape.
        Splitter s = Splitter(splitter);
        assertEq(s.totalRecipients(), 2);
        assertEq(address(s.token()), address(token));
        (address r0, uint16 b0) = s.getRecipient(0);
        assertEq(r0, sellingAgent);
        assertEq(b0, 9_500);
    }

    // ─────────────────────── Case 2: duplicate salt ───────────────────────

    function test_createSplitter_duplicateSalt_reverts() public {
        address[] memory recips = _twoRecips(sellingAgent, platform);
        uint16[]  memory bps    = _twoBps(9_500, 500);
        bytes32 salt = keccak256("dup");

        address deployed = factory.createSplitter(sellingAgent, recips, bps, salt);

        vm.expectRevert(
            abi.encodeWithSelector(SplitterFactory.AlreadyDeployed.selector, deployed)
        );
        factory.createSplitter(sellingAgent, recips, bps, salt);
    }

    // ─────────────────────── Case 3: sellingAgent != recipients[0] ───────────────────────

    function test_createSplitter_sellingAgentMismatchesSlot0_reverts() public {
        address[] memory recips = _twoRecips(platform, sellingAgent); // slot 0 wrong
        uint16[]  memory bps    = _twoBps(5_000, 5_000);
        vm.expectRevert(SplitterFactory.InvalidSellingAgent.selector);
        factory.createSplitter(sellingAgent, recips, bps, bytes32(uint256(1)));
    }

    // ─────────────────────── Case 4: empty recipients ───────────────────────

    function test_createSplitter_emptyRecipients_reverts() public {
        address[] memory recips = new address[](0);
        uint16[]  memory bps    = new uint16[](0);
        vm.expectRevert(SplitterFactory.InvalidSellingAgent.selector);
        factory.createSplitter(sellingAgent, recips, bps, bytes32(uint256(2)));
    }

    // ─────────────────────── Case 5: BPS sum != 10_000 ───────────────────────

    function test_createSplitter_badBpsSum_bubblesSplitterRevert() public {
        address[] memory recips = _twoRecips(sellingAgent, platform);
        uint16[]  memory bps    = _twoBps(5_000, 4_999); // 9_999
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidBpsSum.selector, uint256(9_999)));
        factory.createSplitter(sellingAgent, recips, bps, bytes32(uint256(3)));
    }

    // ─────────────────────── Case 6: zero address in recipients ───────────────────────

    function test_createSplitter_zeroAddressRecipient_bubblesSplitterRevert() public {
        address[] memory recips = _twoRecips(sellingAgent, address(0));
        uint16[]  memory bps    = _twoBps(5_000, 5_000);
        vm.expectRevert(abi.encodeWithSelector(Splitter.ZeroAddress.selector, uint8(1)));
        factory.createSplitter(sellingAgent, recips, bps, bytes32(uint256(4)));
    }

    // ─────────────────────── Case 7: > 8 recipients ───────────────────────

    function test_createSplitter_nineRecipients_bubblesSplitterRevert() public {
        address[] memory recips = new address[](9);
        uint16[]  memory bps    = new uint16[](9);
        recips[0] = sellingAgent;
        for (uint256 i = 1; i < 9; ++i) {
            recips[i] = address(uint160(0x1000 + i));
        }
        for (uint256 i = 0; i < 9; ++i) bps[i] = 1_111;  // 9_999, wrong — but count check fires first
        vm.expectRevert(Splitter.InvalidRecipientCount.selector);
        factory.createSplitter(sellingAgent, recips, bps, bytes32(uint256(5)));
    }

    // ─────────────────────── Case 8: predictAddress round-trip ───────────────────────

    function test_predictAddress_matchesDeployedAddress() public {
        address[] memory recips = new address[](3);
        recips[0] = sellingAgent; recips[1] = platform; recips[2] = treasury;
        uint16[]  memory bps = new uint16[](3);
        bps[0] = 7_000; bps[1] = 2_000; bps[2] = 1_000;
        bytes32 salt = keccak256(abi.encodePacked("alice.reckon402.eth"));

        address predicted = factory.predictAddress(salt, recips, bps);
        address deployed  = factory.createSplitter(sellingAgent, recips, bps, salt);
        assertEq(predicted, deployed, "CREATE2 prediction drift");
    }

    // ─────────────────────── Case 9: isDeployed default false ───────────────────────

    function test_isDeployed_defaultFalseForRandomAddress() public view {
        assertFalse(factory.isDeployed(address(0xdeadbeef)));
        assertFalse(factory.isDeployed(address(this)));
        assertFalse(factory.isDeployed(address(factory)));
    }

    // ─────────────────────── Case 10: fuzz on salt ───────────────────────

    function testFuzz_predictAddress_matchesDeploy(bytes32 salt) public {
        address[] memory recips = _twoRecips(sellingAgent, platform);
        uint16[]  memory bps    = _twoBps(8_000, 2_000);

        address predicted = factory.predictAddress(salt, recips, bps);
        address deployed  = factory.createSplitter(sellingAgent, recips, bps, salt);
        assertEq(predicted, deployed, "CREATE2 prediction drift (fuzz)");
        assertTrue(factory.isDeployed(deployed));
    }

    // ─────────────────────── helpers ───────────────────────

    function _twoRecips(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2); r[0] = a; r[1] = b;
    }
    function _twoBps(uint16 a, uint16 b) internal pure returns (uint16[] memory x) {
        x = new uint16[](2); x[0] = a; x[1] = b;
    }
}

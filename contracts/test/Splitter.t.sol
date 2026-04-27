// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
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

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply += v;
        emit Transfer(address(0), to, v);
    }
}

contract SplitterTest is Test {
    MockERC20 internal token;
    address internal alice = address(0xA1);
    address internal bob   = address(0xB0);
    address internal carol = address(0xC0);

    event Distributed(
        bytes32 indexed paymentId,
        uint8   indexed slot,
        address indexed recipient,
        uint16  bps,
        uint256 amount
    );
    event Deployed(address indexed token, uint8 totalRecipients, address[] recipients, uint16[] bps);

    function setUp() public {
        token = new MockERC20();
    }

    // ───── constructor: success paths ─────

    function test_constructor_singleRecipient_succeeds() public {
        address[] memory r = _recip(alice);
        uint16[] memory b  = _bps(10_000);
        Splitter s = new Splitter(token, r, b);
        assertEq(s.totalRecipients(), 1);
        assertEq(address(s.token()), address(token));
        (address a, uint16 bb) = s.getRecipient(0);
        assertEq(a, alice);
        assertEq(bb, 10_000);
    }

    function test_constructor_twoRecipients_succeeds() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(5_000, 5_000);
        Splitter s = new Splitter(token, r, b);
        assertEq(s.totalRecipients(), 2);
    }

    function test_constructor_eightRecipients_succeeds() public {
        address[] memory r = new address[](8);
        uint16[] memory b  = new uint16[](8);
        for (uint256 i = 0; i < 8; ++i) {
            r[i] = address(uint160(0x100 + i));
            b[i] = 1_250; // 8 * 1250 = 10000
        }
        Splitter s = new Splitter(token, r, b);
        assertEq(s.totalRecipients(), 8);
        (address a7, uint16 b7) = s.getRecipient(7);
        assertEq(a7, address(uint160(0x107)));
        assertEq(b7, 1_250);
    }

    function test_constructor_emitsDeployed() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(7_000, 3_000);
        vm.expectEmit(true, false, false, true);
        emit Deployed(address(token), 2, r, b);
        new Splitter(token, r, b);
    }

    // ───── constructor: revert paths ─────

    function test_constructor_zeroRecipients_reverts() public {
        address[] memory r = new address[](0);
        uint16[] memory b  = new uint16[](0);
        vm.expectRevert(Splitter.InvalidRecipientCount.selector);
        new Splitter(token, r, b);
    }

    function test_constructor_nineRecipients_reverts() public {
        address[] memory r = new address[](9);
        uint16[] memory b  = new uint16[](9);
        for (uint256 i = 0; i < 9; ++i) { r[i] = address(uint160(0x100 + i)); b[i] = 1_000; }
        // 9 * 1000 = 9000, not 10000 — but the count check fires first
        vm.expectRevert(Splitter.InvalidRecipientCount.selector);
        new Splitter(token, r, b);
    }

    function test_constructor_lengthMismatch_reverts() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = new uint16[](1);
        b[0] = 10_000;
        vm.expectRevert(Splitter.InvalidRecipientCount.selector);
        new Splitter(token, r, b);
    }

    function test_constructor_bpsSumNot10000_reverts() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(4_000, 5_000);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidBpsSum.selector, uint256(9_000)));
        new Splitter(token, r, b);
    }

    function test_constructor_zeroAddress_reverts() public {
        address[] memory r = _recip2(alice, address(0));
        uint16[] memory b  = _bps2(5_000, 5_000);
        vm.expectRevert(abi.encodeWithSelector(Splitter.ZeroAddress.selector, uint8(1)));
        new Splitter(token, r, b);
    }

    // ───── distribute ─────

    function test_distribute_twoRecipients_correctSplit() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(7_000, 3_000);
        Splitter s = new Splitter(token, r, b);

        token.mint(address(s), 1_000);
        s.distribute(bytes32(uint256(0xabc)), 1_000);
        assertEq(token.balanceOf(alice), 700);
        assertEq(token.balanceOf(bob),   300);
    }

    function test_distribute_emitsDistributedPerSlot() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(7_000, 3_000);
        Splitter s = new Splitter(token, r, b);

        token.mint(address(s), 1_000);

        bytes32 pid = bytes32(uint256(0xdead));
        vm.expectEmit(true, true, true, true);
        emit Distributed(pid, 0, alice, 7_000, 700);
        vm.expectEmit(true, true, true, true);
        emit Distributed(pid, 1, bob,   3_000, 300);
        s.distribute(pid, 1_000);
    }

    function test_distribute_insufficientBalance_reverts() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(5_000, 5_000);
        Splitter s = new Splitter(token, r, b);

        token.mint(address(s), 500);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InsufficientBalance.selector, uint256(1_000), uint256(500)));
        s.distribute(bytes32(0), 1_000);
    }

    function test_distribute_zeroAmount_isNoop() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(5_000, 5_000);
        Splitter s = new Splitter(token, r, b);

        s.distribute(bytes32(0), 0);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob),   0);
    }

    function test_distribute_anyoneCanCall() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(5_000, 5_000);
        Splitter s = new Splitter(token, r, b);

        token.mint(address(s), 1_000);
        vm.prank(address(0xBEEF));
        s.distribute(bytes32(0), 1_000);
        assertEq(token.balanceOf(alice), 500);
        assertEq(token.balanceOf(bob),   500);
    }

    function test_distribute_dustRemainsInContract() public {
        // Three recipients, 3_333 / 3_333 / 3_334 on 1000 input:
        // shares = 333 / 333 / 333 — total 999, 1 wei dust stays.
        address[] memory r = new address[](3);
        r[0] = alice; r[1] = bob; r[2] = carol;
        uint16[] memory b = new uint16[](3);
        b[0] = 3_333; b[1] = 3_333; b[2] = 3_334;
        Splitter s = new Splitter(token, r, b);

        token.mint(address(s), 1_000);
        s.distribute(bytes32(0), 1_000);
        assertEq(token.balanceOf(alice), 333);
        assertEq(token.balanceOf(bob),   333);
        assertEq(token.balanceOf(carol), 333);
        assertEq(token.balanceOf(address(s)), 1); // dust
    }

    function test_distribute_multipleSequential_clearsBalance() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(5_000, 5_000);
        Splitter s = new Splitter(token, r, b);

        for (uint256 i = 0; i < 5; ++i) {
            token.mint(address(s), 1_000);
            s.distribute(bytes32(uint256(i)), 1_000);
        }
        assertEq(token.balanceOf(alice), 2_500);
        assertEq(token.balanceOf(bob),   2_500);
    }

    // ───── getRecipient ─────

    function test_getRecipient_invalidSlot_reverts() public {
        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(5_000, 5_000);
        Splitter s = new Splitter(token, r, b);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidSlot.selector, uint8(2)));
        s.getRecipient(2);
    }

    function test_getAllRecipients_roundtrips() public {
        address[] memory r = new address[](3);
        r[0] = alice; r[1] = bob; r[2] = carol;
        uint16[] memory b = new uint16[](3);
        b[0] = 5_000; b[1] = 3_000; b[2] = 2_000;
        Splitter s = new Splitter(token, r, b);

        (address[] memory recs, uint16[] memory bps) = s.getAllRecipients();
        assertEq(recs.length, 3);
        assertEq(recs[0], alice); assertEq(bps[0], 5_000);
        assertEq(recs[1], bob);   assertEq(bps[1], 3_000);
        assertEq(recs[2], carol); assertEq(bps[2], 2_000);
    }

    // ───── fuzz ─────

    /// @dev Fuzz: random two-recipient BPS split. Constrain bpsA to [1, 9_999];
    ///      bpsB = 10_000 - bpsA. Amount bounded to uint96 to avoid overflow
    ///      when multiplied by 10_000 (fits comfortably in uint256 budget).
    function testFuzz_distribute_twoRecipients_correctSplit(uint16 bpsA, uint96 amount) public {
        bpsA = uint16(bound(uint256(bpsA), 1, 9_999));
        uint16 bpsB = uint16(10_000 - bpsA);

        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(bpsA, bpsB);
        Splitter s = new Splitter(token, r, b);

        if (amount == 0) {
            s.distribute(bytes32(0), 0);
            assertEq(token.balanceOf(alice), 0);
            assertEq(token.balanceOf(bob), 0);
            return;
        }

        token.mint(address(s), amount);
        s.distribute(bytes32(0), amount);

        uint256 shareA = (uint256(amount) * bpsA) / 10_000;
        uint256 shareB = (uint256(amount) * bpsB) / 10_000;
        assertEq(token.balanceOf(alice), shareA);
        assertEq(token.balanceOf(bob),   shareB);
        assertLe(token.balanceOf(address(s)), 1); // ≤1 wei dust for n=2
    }

    /// @dev Fuzz: constructor rejects any BPS sum != 10_000.
    function testFuzz_constructor_rejectsInvalidBpsSum(uint16 bpsA, uint16 bpsB) public {
        // Exclude the one valid combination.
        vm.assume(uint256(bpsA) + uint256(bpsB) != 10_000);
        vm.assume(bpsA > 0 && bpsB > 0); // ZeroAddress check not relevant here

        address[] memory r = _recip2(alice, bob);
        uint16[] memory b  = _bps2(bpsA, bpsB);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidBpsSum.selector, uint256(bpsA) + uint256(bpsB)));
        new Splitter(token, r, b);
    }

    // ───── helpers ─────

    function _recip(address a) internal pure returns (address[] memory r) {
        r = new address[](1); r[0] = a;
    }
    function _recip2(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2); r[0] = a; r[1] = b;
    }
    function _bps(uint16 a) internal pure returns (uint16[] memory b) {
        b = new uint16[](1); b[0] = a;
    }
    function _bps2(uint16 a, uint16 bb) internal pure returns (uint16[] memory b) {
        b = new uint16[](2); b[0] = a; b[1] = bb;
    }
}

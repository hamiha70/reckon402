// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Splitter } from "../src/Splitter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;
    function transfer(address to, uint256 v) external override returns (bool) {
        balanceOf[msg.sender] -= v; balanceOf[to] += v;
        emit Transfer(msg.sender, to, v); return true;
    }
    function approve(address s, uint256 v) external override returns (bool) {
        allowance[msg.sender][s] = v; emit Approval(msg.sender, s, v); return true;
    }
    function transferFrom(address f, address t, uint256 v) external override returns (bool) {
        allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[t] += v;
        emit Transfer(f, t, v); return true;
    }
    function mint(address to, uint256 v) external {
        balanceOf[to] += v; totalSupply += v; emit Transfer(address(0), to, v);
    }
}

/// @dev Handler drives randomized mint+distribute on the Splitter. Exposed
///      to foundry's invariant fuzzer via `targetContract(...)`. Tracks
///      total minted so invariants can assert conservation-of-balance.
contract Handler is Test {
    Splitter public splitter;
    MockERC20 public token;
    uint256 public totalMinted;

    constructor(Splitter s, MockERC20 t) {
        splitter = s;
        token    = t;
    }

    function mintAndDistribute(uint96 amount, bytes32 pid) external {
        uint256 amt = uint256(amount);
        token.mint(address(splitter), amt);
        totalMinted += amt;
        splitter.distribute(pid, amt);
    }

    function distributeOnly(uint96 amount, bytes32 pid) external {
        uint256 avail = token.balanceOf(address(splitter));
        if (avail == 0) return;
        uint256 amt = uint256(amount) % (avail + 1);
        splitter.distribute(pid, amt);
    }
}

contract SplitterInvariantTest is StdInvariant, Test {
    Splitter public splitter;
    MockERC20 public token;
    Handler   public handler;

    address[] public recipients;
    uint16[]  public bps;

    function setUp() public {
        token = new MockERC20();

        recipients = new address[](3);
        recipients[0] = address(0xA1);
        recipients[1] = address(0xB0);
        recipients[2] = address(0xC0);
        bps = new uint16[](3);
        bps[0] = 5_000; bps[1] = 3_000; bps[2] = 2_000;

        splitter = new Splitter(token, recipients, bps);
        handler  = new Handler(splitter, token);

        targetContract(address(handler));
    }

    /// @notice Conservation: sum of recipient balances + splitter residual
    ///         equals total minted into the splitter over all handler actions.
    function invariant_balancesSumToMinted() public view {
        uint256 sum = token.balanceOf(address(splitter));
        for (uint256 i = 0; i < recipients.length; ++i) {
            sum += token.balanceOf(recipients[i]);
        }
        assertEq(sum, handler.totalMinted());
    }

    /// @notice Immutable state: totalRecipients and each slot's (recipient, bps)
    ///         never change after construction.
    function invariant_immutableState() public view {
        assertEq(splitter.totalRecipients(), uint8(recipients.length));
        for (uint8 i = 0; i < recipients.length; ++i) {
            (address r, uint16 b) = splitter.getRecipient(i);
            assertEq(r, recipients[i]);
            assertEq(b, bps[i]);
        }
    }

    /// @notice Splitter residual is bounded by dust ceiling: at most
    ///         `totalRecipients` per distribute call accumulates. Since the
    ///         handler may distribute less than the full balance, residual
    ///         can grow unboundedly in "distributeOnly with small amount"
    ///         sequences — so we only assert the conservation invariant
    ///         above, not a hard dust cap. This placeholder is kept for
    ///         documentation; the real guarantee is balancesSumToMinted.
    function invariant_noFundsAppearFromNowhere() public view {
        // Captured by invariant_balancesSumToMinted.
        assertLe(token.balanceOf(address(splitter)), handler.totalMinted());
    }
}

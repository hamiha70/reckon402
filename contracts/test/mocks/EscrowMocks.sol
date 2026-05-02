// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Escrow } from "../../src/Escrow.sol";

/// @notice ERC20 mock with optional reentrancy hook on transfer.
///         Used by Escrow tests to verify nonReentrant guard fires.
contract MockERC20 is IERC20 {
    string  public name     = "MockUSDC";
    string  public symbol   = "mUSDC";
    uint8   public decimals = 6;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    /// @notice If non-null, on every transfer the mock calls `withdraw(amount)`
    ///         on this Escrow instance from the recipient context — used to
    ///         test that the Escrow's nonReentrant guard fires.
    address public reentryTarget;
    uint256 public reentryAmount;

    function setReentryTarget(address t, uint256 amount) external {
        reentryTarget = t;
        reentryAmount = amount;
    }

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply  += v;
        emit Transfer(address(0), to, v);
    }

    function transfer(address to, uint256 v) external override returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to]         += v;
        emit Transfer(msg.sender, to, v);
        if (reentryTarget != address(0)) {
            // Best-effort re-entry; the Escrow's nonReentrant guard should catch
            // and bubble ReentrancyGuardReentrantCall here.
            Escrow(reentryTarget).withdraw(reentryAmount);
        }
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

/// @notice Mock IdentityRegistry exposing a settable per-tokenId owner.
///         Mirrors the slice of ERC-721 the Escrow consumes (`ownerOf` only).
contract MockIdentityRegistry {
    mapping(uint256 => address) public ownerOf_;

    error NotMinted(uint256 tokenId);

    function setOwner(uint256 tokenId, address owner_) external {
        ownerOf_[tokenId] = owner_;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = ownerOf_[tokenId];
        if (o == address(0)) revert NotMinted(tokenId);
        return o;
    }
}

/// @notice Mock ReputationRegistry exposing a settable summary count keyed
///         on the exact tuple the Escrow passes via its `getSummary` call —
///         (agentId, clientAddresses[0], tag1, tag2). Any mismatch in
///         arguments → key miss → count=0, which doubles as the assertion
///         that the Escrow forwards arguments correctly.
contract MockReputationRegistry {
    /// @dev Storage key: keccak256(abi.encode(agentId, clients[0], tag1, tag2))
    mapping(bytes32 => uint64) public count_;

    function setCount(
        uint256 agentId,
        address client,
        string calldata tag1,
        string calldata tag2,
        uint64 count
    ) external {
        bytes32 k = keccak256(abi.encode(agentId, client, tag1, tag2));
        count_[k] = count;
    }

    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string  calldata tag1,
        string  calldata tag2
    )
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        // Match upstream ReputationRegistry behaviour: revert on empty client
        // list. Escrow always passes exactly one element.
        require(clientAddresses.length > 0, "clientAddresses required");
        bytes32 k = keccak256(abi.encode(agentId, clientAddresses[0], tag1, tag2));
        return (count_[k], 0, 0);
    }
}

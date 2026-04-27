// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  Reckon402 Splitter (v1)
/// @notice Immutable BPS-based payment distributor for x402 settlements.
/// @dev    No admin, no upgrade, no rescue. By construction, the operator
///         cannot move user funds. Permissionless distribute(); replay
///         protection on paymentId is enforced at the facilitator layer,
///         not on-chain.
contract Splitter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint8  public immutable totalRecipients;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8  public constant MAX_RECIPIENTS  = 8;

    address private immutable r0;
    address private immutable r1;
    address private immutable r2;
    address private immutable r3;
    address private immutable r4;
    address private immutable r5;
    address private immutable r6;
    address private immutable r7;
    uint16  private immutable b0;
    uint16  private immutable b1;
    uint16  private immutable b2;
    uint16  private immutable b3;
    uint16  private immutable b4;
    uint16  private immutable b5;
    uint16  private immutable b6;
    uint16  private immutable b7;

    event Distributed(
        bytes32 indexed paymentId,
        uint8   indexed slot,
        address indexed recipient,
        uint16  bps,
        uint256 amount
    );

    event Deployed(
        address indexed token,
        uint8           totalRecipients,
        address[]       recipients,
        uint16[]        bps
    );

    error InvalidRecipientCount();
    error InvalidBpsSum(uint256 actual);
    error ZeroAddress(uint8 slot);
    error InsufficientBalance(uint256 requested, uint256 available);
    error InvalidSlot(uint8 slot);

    constructor(
        IERC20           _token,
        address[] memory _recipients,
        uint16[]  memory _bps
    ) {
        uint256 n = _recipients.length;
        if (n == 0 || n > MAX_RECIPIENTS || n != _bps.length) {
            revert InvalidRecipientCount();
        }

        uint256 sum;
        for (uint256 i = 0; i < n; ++i) {
            if (_recipients[i] == address(0)) revert ZeroAddress(uint8(i));
            sum += _bps[i];
        }
        if (sum != BPS_DENOMINATOR) revert InvalidBpsSum(sum);

        token           = _token;
        totalRecipients = uint8(n);

        r0 = n > 0 ? _recipients[0] : address(0);
        r1 = n > 1 ? _recipients[1] : address(0);
        r2 = n > 2 ? _recipients[2] : address(0);
        r3 = n > 3 ? _recipients[3] : address(0);
        r4 = n > 4 ? _recipients[4] : address(0);
        r5 = n > 5 ? _recipients[5] : address(0);
        r6 = n > 6 ? _recipients[6] : address(0);
        r7 = n > 7 ? _recipients[7] : address(0);
        b0 = n > 0 ? _bps[0] : 0;
        b1 = n > 1 ? _bps[1] : 0;
        b2 = n > 2 ? _bps[2] : 0;
        b3 = n > 3 ? _bps[3] : 0;
        b4 = n > 4 ? _bps[4] : 0;
        b5 = n > 5 ? _bps[5] : 0;
        b6 = n > 6 ? _bps[6] : 0;
        b7 = n > 7 ? _bps[7] : 0;

        emit Deployed(address(_token), uint8(n), _recipients, _bps);
    }

    /// @notice Distribute `amount` of token across the immutable recipient set by BPS.
    /// @dev    Anyone can call. Splitter must hold >= amount of token.
    /// @param  paymentId Facilitator-assigned payment identifier (event-only).
    /// @param  amount    Amount to distribute; must be <= token balance of this contract.
    function distribute(bytes32 paymentId, uint256 amount) external {
        uint256 bal = token.balanceOf(address(this));
        if (bal < amount) revert InsufficientBalance(amount, bal);

        uint8 n = totalRecipients;
        for (uint8 i = 0; i < n; ++i) {
            (address recipient, uint16 bps) = getRecipient(i);
            uint256 share = (amount * bps) / BPS_DENOMINATOR;
            if (share > 0) {
                token.safeTransfer(recipient, share);
                emit Distributed(paymentId, i, recipient, bps, share);
            }
        }
    }

    function getRecipient(uint8 slot) public view returns (address recipient, uint16 bps) {
        if (slot >= totalRecipients) revert InvalidSlot(slot);
        if (slot == 0) return (r0, b0);
        if (slot == 1) return (r1, b1);
        if (slot == 2) return (r2, b2);
        if (slot == 3) return (r3, b3);
        if (slot == 4) return (r4, b4);
        if (slot == 5) return (r5, b5);
        if (slot == 6) return (r6, b6);
        return (r7, b7);
    }

    function getAllRecipients()
        external
        view
        returns (address[] memory recipients, uint16[] memory bps)
    {
        uint8 n = totalRecipients;
        recipients = new address[](n);
        bps        = new uint16[](n);
        for (uint8 i = 0; i < n; ++i) {
            (recipients[i], bps[i]) = getRecipient(i);
        }
    }
}

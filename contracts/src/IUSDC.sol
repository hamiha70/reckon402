// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal subset of USDC (FiatTokenV2_2) needed for the Splitter fork test.
///         Reads DOMAIN_SEPARATOR at runtime from the live contract — do not
///         hard-code the EIP-712 domain.
interface IUSDC is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
}

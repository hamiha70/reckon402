// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IExtendedResolver } from "./interfaces/IExtendedResolver.sol";
import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title  Reckon402Resolver
/// @notice ENSIP-10 wildcard resolver with EIP-3668 OffchainLookup (Pattern A).
/// @dev    Pattern A: msg.sender is encoded into callData/extraData so the
///         off-chain gateway can serve per-caller responses without HTTP auth.
///         The resolver holds no funds and no settlement state. Ownable is used
///         only for signer rotation and gateway URL updates — see
///         specs/04-l4a-gateway.md §3.1 (custody analysis).
contract Reckon402Resolver is IExtendedResolver, ERC165, Ownable {

    // ─── EIP-3668 error ────────────────────────────────────────────────────

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    // ─── Custom errors ─────────────────────────────────────────────────────

    error UnauthorizedSigner(address signer);
    error StaleResponse(uint64 timestamp, uint64 freshnessWindow);
    error MalformedCallData();

    // ─── State ─────────────────────────────────────────────────────────────

    /// @notice Authorized signers (gateway hot keys). Responses signed by any
    ///         authorized signer pass the callback check.
    mapping(address signer => bool authorized) public signers;

    /// @notice Gateway URL list. The EIP-3668 client tries each URL in order.
    string[] public gatewayUrls;

    /// @notice Responses older than this are rejected in the callback.
    uint64 public constant FRESHNESS_WINDOW = 300;

    // ─── Events ────────────────────────────────────────────────────────────

    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event GatewayUrlsUpdated(string[] urls);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(string[] memory _gatewayUrls, address _initialSigner)
        Ownable(msg.sender)
    {
        gatewayUrls = _gatewayUrls;
        signers[_initialSigner] = true;
        emit SignerAdded(_initialSigner);
    }

    // ─── Owner setters ─────────────────────────────────────────────────────

    function addSigner(address signer) external onlyOwner {
        signers[signer] = true;
        emit SignerAdded(signer);
    }

    function removeSigner(address signer) external onlyOwner {
        delete signers[signer];
        emit SignerRemoved(signer);
    }

    function setGatewayUrls(string[] calldata urls) external onlyOwner {
        gatewayUrls = urls;
        emit GatewayUrlsUpdated(urls);
    }

    // ─── ENSIP-10 entry point ──────────────────────────────────────────────

    /// @notice Wildcard resolver entry point. Always reverts with OffchainLookup.
    /// @param  name DNS-encoded ENS name being resolved.
    /// @param  data ABI-encoded resolver function call (e.g. text(bytes32,string)).
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory)
    {
        // Pattern A: pack msg.sender (the original EOA or Universal Resolver)
        // into both callData and extraData. The off-chain `sender` parameter
        // that EIP-3668 clients pass to the gateway is address(this) — not the
        // user EOA. The user EOA travels inside callData.
        bytes memory payload = abi.encode(name, msg.sender, data);

        revert OffchainLookup(
            address(this),
            gatewayUrls,
            payload,
            this.resolveCallback.selector,
            payload  // extraData echoes callData for digest binding
        );
    }

    // ─── EIP-3668 callback ─────────────────────────────────────────────────

    /// @notice EIP-3668 callback. Verifies signature freshness and signer
    ///         authorization, then returns the gateway-supplied result bytes.
    /// @param  response   ABI-encoded (bytes result, uint64 timestamp, bytes32 nonce, bytes sig).
    /// @param  extraData  The extraData echoed from resolve(). Bound into the digest.
    function resolveCallback(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 timestamp, bytes32 nonce, bytes memory sig) =
            abi.decode(response, (bytes, uint64, bytes32, bytes));

        if (block.timestamp > timestamp + FRESHNESS_WINDOW) {
            revert StaleResponse(timestamp, FRESHNESS_WINDOW);
        }

        // Digest: keccak256(abi.encode(result, timestamp, nonce, extraData))
        // wrapped in EIP-191 personal_sign prefix.
        bytes32 digest = keccak256(abi.encode(result, timestamp, nonce, extraData));
        bytes32 ethDigest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        address recovered = ECDSA.recover(ethDigest, sig);
        if (!signers[recovered]) revert UnauthorizedSigner(recovered);

        return result;
    }

    // ─── ERC-165 ───────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return
            interfaceId == type(IExtendedResolver).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}

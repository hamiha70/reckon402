// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Escrow } from "./Escrow.sol";

/// @title  Reckon402 EscrowFactory (v1)
/// @notice Deploys per-agent Escrow contracts via CREATE2 so the orchestrator
///         can pre-compute the Escrow address and wire it into the Splitter's
///         recipient list before the Escrow itself is deployed.
/// @dev    No admin, no upgrade. Mirrors `SplitterFactory` shape: every
///         minted address is recorded in `isDeployed` for resolver-side
///         validation; per-agent deduplication via `escrowOfAgent`.
contract EscrowFactory {
    IERC20  public immutable token;
    address public immutable identityRegistry;
    address public immutable reputationRegistry;

    /// @notice Marker: was this Escrow address minted by us? Used by the
    ///         facilitator/dashboard resolvers to reject forged
    ///         `x402.escrow` ENS records.
    mapping(address => bool) public isDeployed;

    /// @notice One Escrow per agent; second deploy for the same agentId
    ///         reverts with `AlreadyDeployedForAgent`.
    mapping(uint256 => address) public escrowOfAgent;

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

    error AlreadyDeployedForAgent(uint256 agentId);
    error AlreadyDeployedAtAddress(address escrow);
    error ZeroAddress();

    constructor(
        IERC20  token_,
        address identityRegistry_,
        address reputationRegistry_
    ) {
        if (
            address(token_) == address(0) ||
            identityRegistry_ == address(0) ||
            reputationRegistry_ == address(0)
        ) revert ZeroAddress();

        token              = token_;
        identityRegistry   = identityRegistry_;
        reputationRegistry = reputationRegistry_;
    }

    /// @notice Deploy a per-agent Escrow.
    /// @param  agentId            ERC-8004 IdentityRegistry tokenId
    /// @param  facilitatorClient  EOA whose feedback drives the tier ramp
    /// @param  tierThresholds     monotonically increasing attestation counts
    /// @param  tierReleaseBps     each ≤ 10_000, monotonically non-decreasing
    /// @param  tag1               feedback tag1 filter (e.g. "payment")
    /// @param  tag2               feedback tag2 filter (e.g. "x402-settlement")
    /// @param  salt               caller-chosen; orchestrator uses
    ///                            keccak256(abi.encodePacked(ensName, agentId))
    /// @return escrow             deterministic deployed address
    function createEscrow(
        uint256          agentId,
        address          facilitatorClient,
        uint64[]  memory tierThresholds,
        uint16[]  memory tierReleaseBps,
        string    memory tag1,
        string    memory tag2,
        bytes32          salt
    ) external returns (address escrow) {
        if (escrowOfAgent[agentId] != address(0)) {
            revert AlreadyDeployedForAgent(agentId);
        }

        address predicted = predictAddress(
            agentId,
            facilitatorClient,
            tierThresholds,
            tierReleaseBps,
            tag1,
            tag2,
            salt
        );
        if (isDeployed[predicted]) revert AlreadyDeployedAtAddress(predicted);

        // Constructor inside Escrow validates tier-array shape; bubbles
        // TierLengthsMismatch / TierThresholdsNotMonotonic / TierBpsNotMonotonic /
        // TierBpsExceedsDenominator / ZeroAddress through the deploy.
        escrow = address(
            new Escrow{salt: salt}(
                token,
                identityRegistry,
                reputationRegistry,
                agentId,
                facilitatorClient,
                tierThresholds,
                tierReleaseBps,
                tag1,
                tag2
            )
        );

        // `escrow == predicted` by CREATE2 math; record the actually deployed
        // address to avoid relying on toolchain invariants.
        isDeployed[escrow]      = true;
        escrowOfAgent[agentId]  = escrow;

        emit EscrowCreated(
            agentId,
            escrow,
            salt,
            facilitatorClient,
            tierThresholds,
            tierReleaseBps,
            tag1,
            tag2
        );
    }

    /// @notice Compute the CREATE2 address for the given constructor args.
    /// @dev    Read-only helper used by the onboarding orchestrator to
    ///         pre-compute an Escrow address (so it can be embedded in the
    ///         Splitter's `recipients[2]` slot atomically with the factory
    ///         deploy that lands the Escrow at that exact address).
    function predictAddress(
        uint256          agentId,
        address          facilitatorClient,
        uint64[]  memory tierThresholds,
        uint16[]  memory tierReleaseBps,
        string    memory tag1,
        string    memory tag2,
        bytes32          salt
    ) public view returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(Escrow).creationCode,
            abi.encode(
                token,
                identityRegistry,
                reputationRegistry,
                agentId,
                facilitatorClient,
                tierThresholds,
                tierReleaseBps,
                tag1,
                tag2
            )
        );
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(creationCode)
            )
        );
        return address(uint160(uint256(hash)));
    }
}

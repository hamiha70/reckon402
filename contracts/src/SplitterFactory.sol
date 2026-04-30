// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Splitter } from "./Splitter.sol";

/// @title  Reckon402 SplitterFactory (v1)
/// @notice Deploys per-SellingAgent Splitters via CREATE2.
/// @dev    No admin, no upgrade. Salt is caller-chosen so the L4c onboarding
///         script can pick addresses that are unique per (sellingAgentEns,
///         chainId). The factory records every address it has deployed in
///         `isDeployed`, which the facilitator reads at payment time to
///         reject forged `x402.splitter` ENS records.
contract SplitterFactory {
    IERC20 public immutable token;

    /// @notice Addresses deployed by this factory. Read by the facilitator's
    ///         splitter-resolver to validate that an `x402.splitter` ENS
    ///         record came from us, not a forged record pointing at an
    ///         unrelated contract.
    mapping(address => bool) public isDeployed;

    event SplitterCreated(
        address indexed sellingAgent,    // slot 0 recipient by L3 Splitter convention
        address indexed splitter,
        bytes32 indexed salt,
        address[]       recipients,
        uint16[]        bps
    );

    error AlreadyDeployed(address splitter);
    error InvalidSellingAgent();

    constructor(IERC20 _token) {
        token = _token;
    }

    /// @notice Deploy a new Splitter for `sellingAgent`. Reverts if the
    ///         deterministic address is already deployed (repeated salt).
    /// @param  sellingAgent  MUST equal recipients[0] (slot 0 = SellingAgent
    ///                       by L3 Splitter convention).
    /// @param  recipients    1–8 addresses; recipients[0] is the SellingAgent
    ///                       wallet.
    /// @param  bps           BPS per recipient; must sum to 10_000 (enforced
    ///                       by Splitter constructor).
    /// @param  salt          Caller-chosen; onboarding uses
    ///                       keccak256(abi.encodePacked(sellingAgentEnsName)).
    /// @return splitter      Deterministic deployed address.
    function createSplitter(
        address           sellingAgent,
        address[] memory  recipients,
        uint16[]  memory  bps,
        bytes32           salt
    ) external returns (address splitter) {
        if (recipients.length == 0 || recipients[0] != sellingAgent) {
            revert InvalidSellingAgent();
        }

        address predicted = predictAddress(salt, recipients, bps);
        if (isDeployed[predicted]) revert AlreadyDeployed(predicted);

        splitter = address(new Splitter{salt: salt}(token, recipients, bps));
        // `splitter == predicted` by CREATE2 math; record the actually
        // deployed address to avoid relying on toolchain invariants.
        isDeployed[splitter] = true;

        emit SplitterCreated(sellingAgent, splitter, salt, recipients, bps);
    }

    /// @notice Compute the CREATE2 address for given salt + constructor args.
    /// @dev    Read-only helper used by the onboarding script to pre-compute
    ///         a Splitter address (to pre-fill the ENS `x402.splitter`
    ///         record atomically with the factory deploy).
    function predictAddress(
        bytes32           salt,
        address[] memory  recipients,
        uint16[]  memory  bps
    ) public view returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(Splitter).creationCode,
            abi.encode(token, recipients, bps)
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

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script }        from "forge-std/Script.sol";
import { EscrowFactory } from "../src/EscrowFactory.sol";
import { IERC20 }        from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy the EscrowFactory via a standard Foundry broadcast.
///         One factory per chain; the L4d onboarding script points at this
///         deployment to mint per-agent Escrows.
///
/// Env:
///   ESCROW_FACTORY_TOKEN          USDC address on this chain (Base Sepolia =
///                                 0x036CbD53842c5426634e7929541eC2318f3dCF7e)
///   ESCROW_FACTORY_IDENTITY       ERC-8004 IdentityRegistry on this chain
///                                 (Base Sepolia = 0x8004A818BFB912233c491871b3d84c89A494BD9e)
///   ESCROW_FACTORY_REPUTATION     ERC-8004 ReputationRegistry on this chain
///                                 (Base Sepolia = 0x8004B663056A597Dffe9eCcC1965A193B7388713)
contract DeployEscrowFactory is Script {
    function run() external returns (EscrowFactory factory) {
        IERC20  token              = IERC20(vm.envAddress("ESCROW_FACTORY_TOKEN"));
        address identityRegistry   = vm.envAddress("ESCROW_FACTORY_IDENTITY");
        address reputationRegistry = vm.envAddress("ESCROW_FACTORY_REPUTATION");

        vm.startBroadcast();
        factory = new EscrowFactory(token, identityRegistry, reputationRegistry);
        vm.stopBroadcast();
    }
}

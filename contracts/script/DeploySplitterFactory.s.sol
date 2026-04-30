// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { SplitterFactory } from "../src/SplitterFactory.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy the SplitterFactory via a standard Foundry broadcast.
///         One factory per chain; the L4c onboarding script points at this
///         deployment to mint per-SellingAgent Splitters.
///
/// Env:
///   SPLITTER_FACTORY_TOKEN  address of the ERC-20 being distributed (USDC on
///                           Base Sepolia = 0x036CbD53842c5426634e7929541eC2318f3dCF7e)
contract DeploySplitterFactory is Script {
    function run() external returns (SplitterFactory factory) {
        IERC20 token = IERC20(vm.envAddress("SPLITTER_FACTORY_TOKEN"));
        vm.startBroadcast();
        factory = new SplitterFactory(token);
        vm.stopBroadcast();
    }
}

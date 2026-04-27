// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { Splitter } from "../src/Splitter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy Splitter via a standard Foundry broadcast. This script is
///         used for test/staging deploys via a plain PK sender. For the
///         production L3 deploy signed by the KMS deployer EOA, use the
///         TS wrapper at `tools/deploy/deploy-splitter.ts` — forge does
///         not natively sign via AWS KMS.
///
/// Env:
///   SPLITTER_TOKEN       address of the ERC-20 being distributed (USDC on Base Sepolia = 0x036CbD...)
///   SPLITTER_RECIPIENTS  comma-separated recipient addresses
///   SPLITTER_BPS         comma-separated BPS values; must sum to 10_000
contract DeploySplitter is Script {
    function run() external returns (Splitter splitter) {
        IERC20 token = IERC20(vm.envAddress("SPLITTER_TOKEN"));

        address[] memory recipients = vm.envAddress("SPLITTER_RECIPIENTS", ",");
        uint256[] memory bps_u256   = vm.envUint("SPLITTER_BPS", ",");
        require(recipients.length == bps_u256.length, "recipients/bps length mismatch");

        uint16[] memory bps = new uint16[](bps_u256.length);
        for (uint256 i = 0; i < bps_u256.length; ++i) {
            require(bps_u256[i] <= type(uint16).max, "bps overflow");
            bps[i] = uint16(bps_u256[i]);
        }

        vm.startBroadcast();
        splitter = new Splitter(token, recipients, bps);
        vm.stopBroadcast();
    }
}

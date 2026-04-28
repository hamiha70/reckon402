// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { Reckon402Resolver } from "../src/Reckon402Resolver.sol";

/// @notice Deploy Reckon402Resolver to Ethereum Sepolia (or mainnet).
///
/// Required env vars (set via Infisical or export before running):
///   GATEWAY_URL             — e.g. "https://gateway.reckon402.com/lookup/{sender}/{data}"
///   GATEWAY_SIGNER_ADDRESS  — hot signer address (derived from RECKON402_RESOLVER_SIGNER_PK)
///   ETH_SEPOLIA_RPC         — Ethereum Sepolia RPC URL
///   ETHERSCAN_API_KEY       — for --verify flag
///
/// Deploy to Sepolia:
///   infisical run --env dev -- forge script script/DeployResolver.s.sol \
///     --rpc-url $ETH_SEPOLIA_RPC \
///     --broadcast \
///     --verify \
///     --verifier-url https://api-sepolia.etherscan.io/api \
///     --etherscan-api-key $ETHERSCAN_API_KEY
///
/// After deploy, pin the address in deployments/sepolia.json and
/// update RESOLVER_CONTRACT_ADDRESS_SEPOLIA in wrangler.toml [vars].
contract DeployResolver is Script {
    function run() external returns (Reckon402Resolver resolver) {
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address signerAddress   = vm.envAddress("GATEWAY_SIGNER_ADDRESS");

        string[] memory urls = new string[](1);
        urls[0] = gatewayUrl;

        vm.startBroadcast();
        resolver = new Reckon402Resolver(urls, signerAddress);
        vm.stopBroadcast();

        console.log("Reckon402Resolver deployed at:", address(resolver));
        console.log("Initial signer:", signerAddress);
        console.log("Gateway URL:", gatewayUrl);
    }
}

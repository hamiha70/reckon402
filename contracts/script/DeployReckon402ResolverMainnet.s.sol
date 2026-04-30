// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { Reckon402Resolver } from "../src/Reckon402Resolver.sol";

/// @notice Deploy Reckon402Resolver to Ethereum Mainnet.
///
/// Constructor args are identical to the Sepolia deploy (same gateway URL,
/// same signer hot key). This is a fresh deploy; the Sepolia instance at
/// 0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a is unchanged.
///
/// Required env vars (Infisical --env prod):
///   GATEWAY_URL                       — "https://gateway.reckon402.com/lookup/{sender}/{data}"
///   RECKON402_RESOLVER_SIGNER_ADDRESS — hot signer EOA (same as Sepolia; derived from
///                                       RECKON402_RESOLVER_SIGNER_PK already in Infisical)
///   ETH_MAINNET_DEPLOYER_PK           — deployer private key (0x-prefixed 32-byte hex)
///   ETHERSCAN_API_KEY                 — for Etherscan verification
///
/// Dry-run (no broadcast):
///   infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
///     cd contracts
///     forge script script/DeployReckon402ResolverMainnet.s.sol:DeployReckon402ResolverMainnet \
///       --rpc-url "$ETH_MAINNET_RPC_PRIMARY" \
///       --private-key "$ETH_MAINNET_DEPLOYER_PK" \
///       -vvv
///   '
///
/// Live deploy + verify:
///   infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
///     cd contracts
///     forge script script/DeployReckon402ResolverMainnet.s.sol:DeployReckon402ResolverMainnet \
///       --rpc-url "$ETH_MAINNET_RPC_PRIMARY" \
///       --private-key "$ETH_MAINNET_DEPLOYER_PK" \
///       --broadcast \
///       --verify \
///       --verifier-url https://api.etherscan.io/api \
///       --etherscan-api-key "$ETHERSCAN_API_KEY" \
///       -vvv
///   '
///
/// After deploy:
///   1. Pin the address in deployments/mainnet.json.
///   2. Update ETH_MAINNET_RESOLVER_ADDRESS in gateway/wrangler.toml [vars] and
///      [env.production.vars] (see tools/deploy/deploy-resolver-mainnet.md step 4).
///   3. Verify OffchainLookup revert via cast (runbook step 5).
contract DeployReckon402ResolverMainnet is Script {
    function run() external returns (Reckon402Resolver resolver) {
        string memory gatewayUrl  = vm.envString("GATEWAY_URL");
        address signerAddress     = vm.envAddress("RECKON402_RESOLVER_SIGNER_ADDRESS");

        string[] memory urls = new string[](1);
        urls[0] = gatewayUrl;

        vm.startBroadcast();
        resolver = new Reckon402Resolver(urls, signerAddress);
        vm.stopBroadcast();

        console.log("Reckon402Resolver (mainnet) deployed at:", address(resolver));
        console.log("Initial signer:", signerAddress);
        console.log("Gateway URL:", gatewayUrl);
    }
}

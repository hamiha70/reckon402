#!/usr/bin/env node
/**
 * ERC-8004 reputation-registry read probe.
 *
 * Validates that the local Base mainnet RPC pool can reach the
 * ReputationRegistry contract and decode getAttestationCount.
 * A count of 0 is acceptable; the read path proves out the ABI subset
 * + RPC reachability + chain ID alignment.
 *
 * Inputs (env):
 *   BASE_MAINNET_RPC_PRIMARY    Alchemy or other Base mainnet endpoint
 *   ERC8004_REGISTRY_ADDRESS    on-chain registry address (Base mainnet)
 *   ERC8004_AGENT_ADDRESS       agent address to query (Base mainnet)
 *
 * Open question (Q-L0-2): the canonical Base-mainnet ReputationRegistry
 * address is not yet locked in this repo. Until it is, this script
 * exits 2 (SKIP) with a remediation pointer.
 *
 * Exit codes:
 *   0   PASS   prints "<count>" to stdout
 *   1   FAIL   read failed (RPC error, decode error, wrong chain)
 *   2   SKIP   open question unresolved
 */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const RPC = process.env.BASE_MAINNET_RPC_PRIMARY;
const REGISTRY = process.env.ERC8004_REGISTRY_ADDRESS;
const AGENT = process.env.ERC8004_AGENT_ADDRESS;

if (!RPC) {
  console.error("erc8004-read: BASE_MAINNET_RPC_PRIMARY not hydrated");
  process.exit(1);
}

if (!REGISTRY || !AGENT) {
  console.error(
    "erc8004-read: SKIP — ERC8004_REGISTRY_ADDRESS or ERC8004_AGENT_ADDRESS unset.\n" +
    "  Resolve open question Q-L0-2 in specs/00-l0-smoke-tests.md and push\n" +
    "  the addresses to Infisical (reckon402/dev) before re-running L0.",
  );
  process.exit(2);
}

const ABI = [
  {
    type: "function",
    name: "getAttestationCount",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "count", type: "uint256" }],
  },
];

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(RPC),
  });
  const count = await client.readContract({
    address: REGISTRY,
    abi: ABI,
    functionName: "getAttestationCount",
    args: [AGENT],
  });
  console.log(count.toString());
}

main().catch((err) => {
  console.error(`erc8004-read: ${err.shortMessage || err.message || err}`);
  process.exit(1);
});

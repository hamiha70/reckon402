#!/usr/bin/env node
/**
 * ENS CCIP-Read end-to-end probe.
 *
 * Resolves a known wildcard ENS name through a Sepolia resolver that
 * supports CCIP-Read. Validates Pattern A msg.sender recovery from
 * callData. Highest-risk L0 probe — most likely to surface tooling
 * version mismatches with viem's CCIP-Read implementation.
 *
 * Inputs (env):
 *   ENS_TEST_NAME               the wildcard child to resolve
 *                               (e.g. test.reckon402-test.eth)
 *   ENS_EXPECTED_ADDRESS        expected resolution result
 *   ETH_SEPOLIA_RPC_PRIMARY     Ethereum Sepolia RPC URL (NOT Base
 *                               Sepolia — Mainnet ENS resolution path
 *                               uses Sepolia for the test network).
 *                               Hydrated from the same Infisical key
 *                               that rpc.sh §4 exercises.
 *
 * Open question (Q-L0-1): ENS test name + resolver wiring are not yet
 * locked. Until they are, this script exits 2 (SKIP).
 *
 * Exit codes:
 *   0   PASS   prints resolved address to stdout
 *   1   FAIL   resolution failed or address mismatch
 *   2   SKIP   open question unresolved
 */
import { createPublicClient, http, isAddressEqual } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

const NAME = process.env.ENS_TEST_NAME;
const EXPECTED = process.env.ENS_EXPECTED_ADDRESS;
const RPC = process.env.ETH_SEPOLIA_RPC_PRIMARY;

if (!NAME || !EXPECTED || !RPC) {
  console.error(
    "ens-resolve: SKIP — ENS_TEST_NAME, ENS_EXPECTED_ADDRESS, or\n" +
    "  ETH_SEPOLIA_RPC_PRIMARY unset. Resolve open question Q-L0-1\n" +
    "  in specs/00-l0-smoke-tests.md (register the test name + deploy\n" +
    "  a CCIP-Read-compatible resolver on Sepolia, then push the test\n" +
    "  name and expected address to Infisical).",
  );
  process.exit(2);
}

async function main() {
  const client = createPublicClient({
    chain: sepolia,
    transport: http(RPC),
  });

  const resolved = await client.getEnsAddress({
    name: normalize(NAME),
  });

  if (!resolved) {
    console.error(`ens-resolve: name resolved to null`);
    process.exit(1);
  }

  if (!isAddressEqual(resolved, EXPECTED)) {
    console.error(
      `ens-resolve: address mismatch — got ${resolved}, expected ${EXPECTED}`,
    );
    process.exit(1);
  }

  console.log(resolved);
}

main().catch((err) => {
  console.error(`ens-resolve: ${err.shortMessage || err.message || err}`);
  process.exit(1);
});

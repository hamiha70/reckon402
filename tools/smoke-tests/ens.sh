#!/usr/bin/env bash
# Probe 5 — ENS CCIP-Read end-to-end.
# See specs/00-l0-smoke-tests.md §5. Highest-risk probe.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start ens
require node

# Hydrate the ENS open-question values (Q-L0-1) from Infisical, falling
# back to env. The lib/ens-resolve.mjs SKIPs cleanly if any are missing.
# RPC source is the same key that rpc.sh exercises in §4 — single source
# of truth for "Ethereum Sepolia primary".
export ENS_TEST_NAME="${ENS_TEST_NAME:-$(hydrate ENS_TEST_NAME)}"
export ENS_EXPECTED_ADDRESS="${ENS_EXPECTED_ADDRESS:-$(hydrate ENS_EXPECTED_ADDRESS)}"
export ETH_SEPOLIA_RPC_PRIMARY="${ETH_SEPOLIA_RPC_PRIMARY:-$(hydrate ETH_SEPOLIA_RPC_PRIMARY)}"

set +e
out="$(node "$DIR/lib/ens-resolve.mjs" 2>&1)"
rc=$?
set -e

case "$rc" in
  0) probe_pass "resolved=$out" ;;
  2) probe_skip "$out" ;;
  *) probe_fail "$out" ;;
esac

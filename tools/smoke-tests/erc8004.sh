#!/usr/bin/env bash
# Probe 6 — ERC-8004 reputation read on Base mainnet.
# See specs/00-l0-smoke-tests.md §6.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start erc8004
require node

export BASE_MAINNET_RPC_PRIMARY="${BASE_MAINNET_RPC_PRIMARY:-$(hydrate BASE_MAINNET_RPC_PRIMARY)}"
[[ -n "$BASE_MAINNET_RPC_PRIMARY" ]] \
  || probe_fail "BASE_MAINNET_RPC_PRIMARY not hydrated from Infisical"

export ERC8004_REGISTRY_ADDRESS="${ERC8004_REGISTRY_ADDRESS:-$(hydrate ERC8004_REGISTRY_ADDRESS)}"
export ERC8004_AGENT_ADDRESS="${ERC8004_AGENT_ADDRESS:-$(hydrate ERC8004_AGENT_ADDRESS)}"

set +e
out="$(node "$DIR/lib/erc8004-read.mjs" 2>&1)"
rc=$?
set -e

case "$rc" in
  0) probe_pass "count=$out" ;;
  2) probe_skip "$out" ;;
  *) probe_fail "$out" ;;
esac

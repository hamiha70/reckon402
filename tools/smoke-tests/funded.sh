#!/usr/bin/env bash
# Probe 9 — deployer Sepolia ETH funding floor.
# See specs/00-l0-smoke-tests.md §9.
#
# Asserts the reckon402 KMS deployer EOA holds at least the
# minimum healthy ETH balance on each operational testnet, so
# anything signed by aws.sh §3 will actually land on chain.
#
# Floor: 0.01 ETH per chain. Rationale in the spec.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start funded
require curl
require jq

# (chain_label, RPC env key, floor in wei) tuples.
# Floor is 0.01 ETH = 1e16 wei = 10000000000000000.
FLOOR_WEI=10000000000000000
declare -a CHAINS=(
  "base-sep|BASE_SEPOLIA_RPC_PRIMARY"
  "eth-sep|ETH_SEPOLIA_RPC_PRIMARY"
)

deployer="$(hydrate DEPLOYER_EOA)"
[[ -n "$deployer" ]] || probe_fail "DEPLOYER_EOA not hydrated from Infisical"

# Sanity-shape: 0x + 40 hex.
[[ "$deployer" =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || probe_fail "DEPLOYER_EOA has unexpected shape: $deployer"

# eth_getBalance JSON-RPC payload, parameterized on the address.
balance_payload="$(jq -nc --arg addr "$deployer" '{
  jsonrpc: "2.0",
  method:  "eth_getBalance",
  params:  [$addr, "latest"],
  id: 1
}')"

# wei (hex 0x...) to ETH formatted to 4 decimal places. Uses bash
# arithmetic only — keeps the probe dependency-free past curl + jq.
# Caveat: bash arithmetic is 64-bit signed; balances >= 2^63 wei
# (~9.2 ETH) would overflow. For testnet-deployer scale this is fine;
# at L4 / mainnet replace with python or node if balances grow.
wei_hex_to_eth_str() {
  local hex="$1"
  local wei
  wei=$((hex))
  # Whole and fractional parts: 1 ETH = 1e18 wei.
  local whole=$(( wei / 1000000000000000000 ))
  local frac=$(( wei % 1000000000000000000 ))
  # 4 decimal places: divide frac by 1e14, pad to 4 digits.
  local frac4=$(( frac / 100000000000000 ))
  printf '%d.%04d' "$whole" "$frac4"
}

results=()
fail_chain=""

for entry in "${CHAINS[@]}"; do
  label="${entry%%|*}"
  rpc_env="${entry##*|}"

  rpc_url="$(hydrate "$rpc_env")"
  [[ -n "$rpc_url" ]] || probe_fail "$rpc_env not hydrated from Infisical"

  resp="$(curl -sS --max-time 5 \
    -X POST -H "Content-Type: application/json" \
    --data "$balance_payload" \
    "$rpc_url" 2>&1 || true)"

  hex="$(echo "$resp" | jq -r '.result // empty' 2>/dev/null || true)"
  if [[ -z "$hex" || "$hex" == "null" ]]; then
    probe_fail "$label eth_getBalance no result: $(printf '%s' "$resp" | head -c 200)"
  fi

  wei=$((hex))
  eth_str="$(wei_hex_to_eth_str "$hex")"

  if (( wei < FLOOR_WEI )); then
    fail_chain="${fail_chain}${fail_chain:+,}${label}=${eth_str}eth"
  fi
  results+=("${label}=${eth_str}eth")
done

if [[ -n "$fail_chain" ]]; then
  probe_fail "below floor 0.01eth on: ${fail_chain} (deployer=$deployer)"
fi

probe_pass "$(IFS=' '; echo "${results[*]}") floor=0.01eth deployer=$deployer"

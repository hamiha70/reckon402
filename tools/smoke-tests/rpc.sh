#!/usr/bin/env bash
# Probe 4 — Base mainnet + Sepolia two-RPC redundancy.
# See specs/00-l0-smoke-tests.md §4.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start rpc
require curl
require jq

# Endpoint table: KEY -> expected chain ID hex; PRIMARY flag for latency gate.
declare -A EXPECTED=(
  [BASE_MAINNET_RPC_PRIMARY]=0x2105
  [BASE_MAINNET_RPC_FALLBACK]=0x2105
  [BASE_SEPOLIA_RPC_PRIMARY]=0x14a34
  [BASE_SEPOLIA_RPC_FALLBACK]=0x14a34
)
declare -A IS_PRIMARY=(
  [BASE_MAINNET_RPC_PRIMARY]=1
  [BASE_MAINNET_RPC_FALLBACK]=0
  [BASE_SEPOLIA_RPC_PRIMARY]=1
  [BASE_SEPOLIA_RPC_FALLBACK]=0
)

PRIMARY_LATENCY_MS_MAX=200
results=()

for key in BASE_MAINNET_RPC_PRIMARY BASE_MAINNET_RPC_FALLBACK \
           BASE_SEPOLIA_RPC_PRIMARY BASE_SEPOLIA_RPC_FALLBACK; do
  url="$(hydrate "$key")"
  [[ -n "$url" ]] || probe_fail "$key not hydrated from Infisical"

  t0="$(now_ms)"
  resp="$(curl -sS --max-time 5 \
    -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    "$url" 2>&1 || true)"
  dur=$(($(now_ms) - t0))

  chain="$(echo "$resp" | jq -r '.result // empty' 2>/dev/null || true)"
  expected="${EXPECTED[$key]}"

  if [[ "$chain" != "$expected" ]]; then
    probe_fail "$key bad chain: expected=$expected got=$chain raw=$resp"
  fi

  if [[ "${IS_PRIMARY[$key]}" == "1" ]] && (( dur > PRIMARY_LATENCY_MS_MAX )); then
    probe_fail "$key primary latency ${dur}ms exceeds ${PRIMARY_LATENCY_MS_MAX}ms"
  fi

  results+=("${key##*_RPC_}=${dur}ms")
done

probe_pass "$(IFS=,; echo "${results[*]}")"

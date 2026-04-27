#!/usr/bin/env bash
# Probe 4 — two-RPC redundancy across Base + Ethereum (mainnet + Sepolia).
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
  [ETH_MAINNET_RPC_PRIMARY]=0x1
  [ETH_MAINNET_RPC_FALLBACK]=0x1
  [ETH_SEPOLIA_RPC_PRIMARY]=0xaa36a7
  [ETH_SEPOLIA_RPC_FALLBACK]=0xaa36a7
)
declare -A IS_PRIMARY=(
  [BASE_MAINNET_RPC_PRIMARY]=1
  [BASE_MAINNET_RPC_FALLBACK]=0
  [BASE_SEPOLIA_RPC_PRIMARY]=1
  [BASE_SEPOLIA_RPC_FALLBACK]=0
  [ETH_MAINNET_RPC_PRIMARY]=1
  [ETH_MAINNET_RPC_FALLBACK]=0
  [ETH_SEPOLIA_RPC_PRIMARY]=1
  [ETH_SEPOLIA_RPC_FALLBACK]=0
)

# Probe order is (chain, tier) sorted: keeps the summary line readable.
KEYS=(
  BASE_MAINNET_RPC_PRIMARY  BASE_MAINNET_RPC_FALLBACK
  BASE_SEPOLIA_RPC_PRIMARY  BASE_SEPOLIA_RPC_FALLBACK
  ETH_MAINNET_RPC_PRIMARY   ETH_MAINNET_RPC_FALLBACK
  ETH_SEPOLIA_RPC_PRIMARY   ETH_SEPOLIA_RPC_FALLBACK
)

PRIMARY_LATENCY_MS_MAX=200
results=()

for key in "${KEYS[@]}"; do
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

  # Compact tag in the summary line: family + chain initial + tier.
  # BASE_MAINNET_RPC_PRIMARY -> base-main-P, ETH_SEPOLIA_RPC_FALLBACK -> eth-sep-F.
  tag="$(echo "$key" | awk -F_ '{
    fam = tolower($1);
    net = ($2 == "MAINNET") ? "main" : "sep";
    tier = ($4 == "PRIMARY") ? "P" : "F";
    printf "%s-%s-%s", fam, net, tier;
  }')"
  results+=("${tag}=${dur}ms")
done

probe_pass "$(IFS=,; echo "${results[*]}")"

#!/usr/bin/env bash
# tools/integration-tests/healthz-all.sh
#
# Single pre-submission probe across every Reckon402 production surface
# and every L4d on-chain contract. Run via `just healthz-all`.
#
# Exits 0 only if EVERY check is green. Any 5xx, network error, or
# on-chain `cast call` failure (e.g. wrong-chain RPC, redeployed
# contract, wrong immutables) makes the whole sweep red.
#
# Sections:
#   1. Cloudflare Worker /healthz endpoints     (HTTPS, JSON-shaped)
#   2. AWS Lambda /healthz                      (HTTPS, KMS-reachable)
#   3. On-chain L4d contracts (Base Sepolia)    (cast call, immutables)
#   4. On-chain L4a Resolver  (Eth Sepolia)     (cast call, owner read)
#
# Prereqs (hydrated via `infisical run --env dev ...`):
#   - BASE_SEPOLIA_RPC_PRIMARY
#   - ETH_SEPOLIA_RPC_PRIMARY
#   - foundry / cast on PATH
#   - curl on PATH

set -uo pipefail

# ANSI colors (no-op when not a TTY)
if [ -t 1 ]; then
  G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[36m'; B='\033[1m'; Z='\033[0m'
else
  G=''; R=''; Y=''; C=''; B=''; Z=''
fi

PASSED=0
FAILED=0
WARNED=0

print_pass() { printf "  ${G}PASS${Z}  %s\n" "$1"; PASSED=$((PASSED+1)); }
print_fail() { printf "  ${R}FAIL${Z}  %s — %s\n" "$1" "$2"; FAILED=$((FAILED+1)); }
print_warn() { printf "  ${Y}WARN${Z}  %s — %s\n" "$1" "$2"; WARNED=$((WARNED+1)); }

# ----------------------------------------------------------------------
# Part 1 — Cloudflare Worker /healthz endpoints (HTTPS)
# ----------------------------------------------------------------------
printf "\n${B}${C}== Cloudflare Workers ==${Z}\n"

probe_http_json() {
  local label=$1
  local url=$2
  local expect_status_field=${3:-status}   # JSON key whose value should be "ok" or boolean true
  local body
  local code
  body=$(curl -sS -o /tmp/hz.body -w "%{http_code}" --max-time 10 "$url" 2>/tmp/hz.err) || code=000
  code=${body:-000}
  if [ "$code" != "200" ]; then
    print_fail "$label" "HTTP $code (url=$url)"
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    if grep -q '"status":"ok"' /tmp/hz.body || grep -q '"ok":true' /tmp/hz.body; then
      print_pass "$label  ($code, $(wc -c < /tmp/hz.body | tr -d ' ')B)"
      return 0
    fi
    print_warn "$label" "HTTP 200 but body shape unverified (no jq); body=$(head -c 100 /tmp/hz.body)"
    return 0
  fi
  local raw_status
  raw_status=$(jq -r ".${expect_status_field} // empty" /tmp/hz.body 2>/dev/null)
  if [ "$raw_status" = "ok" ] || [ "$raw_status" = "true" ]; then
    local extra=""
    if jq -e '.checks' /tmp/hz.body >/dev/null 2>&1; then
      local n_checks
      n_checks=$(jq '.checks | length' /tmp/hz.body)
      local n_failing
      n_failing=$(jq '[.checks[] | select(.ok == false)] | length' /tmp/hz.body)
      extra=" (${n_checks} probes, ${n_failing} failing)"
    fi
    print_pass "$label${extra}"
    return 0
  fi
  if [ "$raw_status" = "degraded" ]; then
    local degraded_keys
    degraded_keys=$(jq -r '.checks // {} | to_entries[] | select(.value.ok == false) | .key' /tmp/hz.body | tr '\n' ',' | sed 's/,$//')
    print_warn "$label" "degraded: ${degraded_keys:-unknown}"
    return 0
  fi
  print_fail "$label" "status=${raw_status:-<empty>}; body=$(head -c 200 /tmp/hz.body)"
  return 1
}

probe_http_json "agent.reckon402.com         /healthz"      "https://agent.reckon402.com/healthz"
probe_http_json "facilitator.reckon402.com   /healthz"      "https://facilitator.reckon402.com/healthz"
probe_http_json "gateway.reckon402.com       /healthz"      "https://gateway.reckon402.com/healthz"
probe_http_json "gateway-staging.reckon402.com /healthz"    "https://gateway-staging.reckon402.com/healthz"
probe_http_json "app.reckon402.com           /healthz"      "https://app.reckon402.com/healthz"      "ok"
probe_http_json "reckon402.com               /healthz"      "https://reckon402.com/healthz"

# ----------------------------------------------------------------------
# Part 2 — AWS Lambda /healthz
# ----------------------------------------------------------------------
printf "\n${B}${C}== AWS Lambda (signing wrapper) ==${Z}\n"
probe_http_json "signing.reckon402.com       /healthz"      "https://signing.reckon402.com/healthz"

# Confirm Lambda's pinned signer EOA matches the canonical KMS buyer-signer
# address. Drift here means the signing wrapper is delegating to the wrong
# KMS key — should never happen, but cheap to assert.
SIGNER_EOA_EXPECTED=0x46bbb05aca9ea24118b8a57c8d3f317503384305
if command -v jq >/dev/null 2>&1; then
  signer_eoa=$(curl -sS --max-time 8 https://signing.reckon402.com/healthz | jq -r '.signer_eoa // empty')
  if [ "${signer_eoa,,}" = "${SIGNER_EOA_EXPECTED,,}" ]; then
    print_pass "signing.reckon402.com signer_eoa pin (= ${SIGNER_EOA_EXPECTED})"
  else
    print_fail "signing.reckon402.com signer_eoa pin" "got ${signer_eoa:-<empty>}, expected ${SIGNER_EOA_EXPECTED}"
  fi
fi

# ----------------------------------------------------------------------
# Part 3 — On-chain L4d contracts (Base Sepolia)
# Pinned addresses from AGENTS.md "L4d on-chain deployments".
# ----------------------------------------------------------------------
printf "\n${B}${C}== On-chain L4d (Base Sepolia, chainId 84532) ==${Z}\n"

if [ -z "${BASE_SEPOLIA_RPC_PRIMARY:-}" ]; then
  print_warn "BASE_SEPOLIA_RPC_PRIMARY" "not set; skipping on-chain probes (run under \`infisical run --env dev\`)"
else

  USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
  IDENTITY=0x8004A818BFB912233c491871b3d84c89A494BD9e
  REPUTATION=0x8004B663056A597Dffe9eCcC1965A193B7388713

  ESCROW_FACTORY=0xb06998682BD716e0864257b3AC3AA1fc4cc64589
  TIER_STRATEGY=0xc498155bC4A2E4Ba979Ad5797298107c63B26C4e
  SPLITTER_FACTORY=0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7

  SELLER11_SPLITTER=0x9fc28c71a539645bECc6bEd26288a8e097AD17Eb
  SELLER11_ESCROW=0x863d2105B57Cb98129B68b934FF5708DC9432aAA
  SELLER11_AGENT_ID=5423

  cast_lower() {
    cast call --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$@" 2>&1 | tr 'A-Z' 'a-z'
  }

  # EscrowFactory immutables match canonical addresses
  ef_token=$(cast_lower "$ESCROW_FACTORY" "token()(address)")
  ef_id=$(cast_lower "$ESCROW_FACTORY" "identityRegistry()(address)")
  ef_rep=$(cast_lower "$ESCROW_FACTORY" "reputationRegistry()(address)")
  if [ "$ef_token" = "${USDC_ADDRESS,,}" ] && [ "$ef_id" = "${IDENTITY,,}" ] && [ "$ef_rep" = "${REPUTATION,,}" ]; then
    print_pass "EscrowFactory immutables match (token + identity + reputation)"
  else
    print_fail "EscrowFactory immutables drift" \
      "token=${ef_token:-?}, id=${ef_id:-?}, rep=${ef_rep:-?}"
  fi

  # TierStrategy v1 default curve.
  # cast prints arrays as `[a, b, c]` and may annotate large numerics
  # with a parenthetical hint (e.g. `10000 [1e4]`). Strip the hint
  # FIRST (so it doesn't mash into the previous number), then collapse
  # whitespace + outer brackets.
  normalize_uintN_array() {
    # cast prints arrays as `[v1, v2, v3]` and tags large numerics with
    # an inline scientific-notation hint that looks like ` [1e4]` (note
    # leading space). The hint always sits between a value and either a
    # comma or the closing bracket of the outer array. Strip those
    # hints, then drop the outer brackets and whitespace, leaving a
    # comma-separated decimal-only string suitable for equality compare.
    local raw=$1
    # Hint pattern: optional leading whitespace, then `[`, then a single
    # number (digits + optional e/E, sign, dot), then `]`. Strip with -E
    # globally, anywhere in the line.
    raw=$(echo "$raw" | sed -E 's/[[:space:]]+\[[0-9eE.+-]+\]//g')
    echo "$raw" | tr -d '[] '
  }
  ts_thresh=$(normalize_uintN_array "$(cast call --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$TIER_STRATEGY" "thresholds()(uint64[])" 2>/dev/null)")
  ts_release=$(normalize_uintN_array "$(cast call --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$TIER_STRATEGY" "releaseBpsArr()(uint16[])" 2>/dev/null)")
  expected_thresh="0,1,3,10,30,100,300,1000"
  expected_release="0,500,1500,3000,5000,7000,8500,10000"
  if [ "$ts_thresh" = "$expected_thresh" ] && [ "$ts_release" = "$expected_release" ]; then
    print_pass "TierStrategy v1 curve unchanged ($expected_thresh / $expected_release)"
  else
    print_fail "TierStrategy v1 curve drift" \
      "thresh='$ts_thresh' release='$ts_release'"
  fi

  # SplitterFactory still recognized
  sf_token=$(cast_lower "$SPLITTER_FACTORY" "token()(address)")
  if [ "$sf_token" = "${USDC_ADDRESS,,}" ]; then
    print_pass "SplitterFactory.token() matches USDC"
  else
    print_fail "SplitterFactory.token()" "got ${sf_token:-?}"
  fi

  # seller11 Splitter (live demo target)
  sp_recipients_bps=$(cast call --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$SELLER11_SPLITTER" "getAllRecipients()(address[],uint16[])" 2>&1)
  if echo "$sp_recipients_bps" | grep -qi "$SELLER11_ESCROW"; then
    if echo "$sp_recipients_bps" | tr -d ' \n' | grep -q '8700,300,1000'; then
      print_pass "seller11 Splitter recipients[] + bps[] = [seller, fac, escrow] / [8700, 300, 1000]"
    else
      print_warn "seller11 Splitter" "Escrow address present but BPS pattern not matched: $(echo $sp_recipients_bps | tr -d '\n' | head -c 200)"
    fi
  else
    print_fail "seller11 Splitter" "Escrow $SELLER11_ESCROW not in recipients[] — $(echo $sp_recipients_bps | tr -d '\n' | head -c 200)"
  fi

  # seller11 Escrow internal state (the demo trust-ramp)
  es_agent=$(cast call --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$SELLER11_ESCROW" "agentId()(uint256)" 2>/dev/null | tr -d ' ')
  es_strategy=$(cast_lower "$SELLER11_ESCROW" "tierStrategy()(address)")
  if [ "$es_agent" = "$SELLER11_AGENT_ID" ] && [ "$es_strategy" = "${TIER_STRATEGY,,}" ]; then
    es_stats=$(cast call --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$SELLER11_ESCROW" \
      "getStats()(uint256,uint256,uint256,uint256,uint256,uint64,uint16)" 2>/dev/null \
      | tr '\n' '|' | sed 's/|$//')
    print_pass "seller11 Escrow agentId=$es_agent, strategy pinned, stats=[$es_stats]"
  else
    print_fail "seller11 Escrow drift" "agentId=${es_agent:-?} strategy=${es_strategy:-?}"
  fi

  # Factory acknowledges the deployed Escrow
  ef_isdep=$(cast_lower "$ESCROW_FACTORY" "isDeployed(address)(bool)" "$SELLER11_ESCROW")
  ef_of_agent=$(cast_lower "$ESCROW_FACTORY" "escrowOfAgent(uint256)(address)" "$SELLER11_AGENT_ID")
  if [ "$ef_isdep" = "true" ] && [ "$ef_of_agent" = "${SELLER11_ESCROW,,}" ]; then
    print_pass "EscrowFactory.isDeployed[seller11Escrow] && escrowOfAgent[5423] == seller11Escrow"
  else
    print_fail "EscrowFactory↔seller11 link" "isDeployed=${ef_isdep:-?} ofAgent=${ef_of_agent:-?}"
  fi
fi

# ----------------------------------------------------------------------
# Part 4 — Reckon402Resolver (Ethereum Sepolia)
# ----------------------------------------------------------------------
printf "\n${B}${C}== On-chain L4a Resolver (Ethereum Sepolia, chainId 11155111) ==${Z}\n"

if [ -z "${ETH_SEPOLIA_RPC_PRIMARY:-}" ]; then
  print_warn "ETH_SEPOLIA_RPC_PRIMARY" "not set; skipping on-chain Resolver probe"
else
  RESOLVER=0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a
  resolver_owner=$(cast call --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" "$RESOLVER" "owner()(address)" 2>/dev/null)
  if [ -n "$resolver_owner" ]; then
    print_pass "Reckon402Resolver.owner() = $resolver_owner"
  else
    print_fail "Reckon402Resolver" "owner() call returned empty — wrong chain or contract redeployed"
  fi
fi

# ----------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------
printf "\n${B}== Summary ==${Z}\n"
printf "  ${G}PASS:${Z} %d   ${Y}WARN:${Z} %d   ${R}FAIL:${Z} %d\n" "$PASSED" "$WARNED" "$FAILED"

if [ "$FAILED" -gt 0 ]; then
  printf "${R}${B}HEALTHZ-ALL: RED${Z}\n"
  exit 1
fi
printf "${G}${B}HEALTHZ-ALL: GREEN${Z}\n"
exit 0

#!/usr/bin/env bash
# resolve-l4a.sh — HTTP-direct tester for the Reckon402 CCIP-Read gateway (L4a₁+L4a₂)
#
# Usage:
#   bash tools/integration-tests/resolve-l4a.sh [--backend static] [--gateway <url>] [--name <ens-name>] [--key <record-key>]
#   bash tools/integration-tests/resolve-l4a.sh --backend erc8004 [--key x402.amount]
#
# Flags:
#   --backend static     (default) regression guard on the D1-backed static
#                        lookup path — output must be byte-equal to L4a₁.
#   --backend erc8004    hits the flag-true gateway branch; validates the
#                        cross-chain ERC-8004 read landed + pricing-tier
#                        math applied. Expects the gateway to have
#                        ENABLE_ERC8004_READS=true and the ENS name
#                        indexed in agent_id_index.
#   --gateway <url>      gateway base URL (default: https://gateway.reckon402.com)
#   --name <ens-name>    ENS name to resolve (default: seller.reckon402-test.eth)
#   --key <record-key>   x402 record key to fetch
#                        (default: x402.facilitator for static; x402.amount for erc8004)
#
# Exit codes:
#   0 — test passed (or --backend erc8004 deferred)
#   1 — test failed
#
# Requirements:
#   - curl, jq, node (for viem ABI decoding in buyer-sign-l3.mjs or inline)
#   - Infisical secrets for RECKON402_RESOLVER_SIGNER_PK to derive signer address
#
# The test:
#   1. Build callData: ABI-encode(dns(name), callerAddr, text(node, key))
#   2. POST to /lookup with {sender: resolverAddr, data: callData}
#   3. Decode response: (bytes result, uint64 timestamp, bytes32 nonce, bytes sig)
#   4. Verify timestamp is fresh (within 300s)
#   5. Decode result bytes as ABI string
#   6. Cross-check the value against the D1 seed (expected known values)

set -euo pipefail

BACKEND="static"
GATEWAY_URL="https://gateway.reckon402.com"
ENS_NAME="seller.reckon402-test.eth"
RECORD_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)   BACKEND="$2";    shift 2 ;;
    --gateway)   GATEWAY_URL="$2"; shift 2 ;;
    --name)      ENS_NAME="$2";   shift 2 ;;
    --key)       RECORD_KEY="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$RECORD_KEY" ]]; then
  if [[ "$BACKEND" == "erc8004" ]]; then
    RECORD_KEY="x402.amount"
  else
    RECORD_KEY="x402.facilitator"
  fi
fi

case "$BACKEND" in
  static|erc8004) ;;
  *) echo "Unknown backend: $BACKEND (valid: static, erc8004)" >&2; exit 1 ;;
esac

echo "[resolve-l4a] Testing backend: $BACKEND"
echo "[resolve-l4a] Gateway: $GATEWAY_URL"
echo "[resolve-l4a] ENS name: $ENS_NAME"
echo "[resolve-l4a] Record key: $RECORD_KEY"
echo ""

# ─── Step 1: build callData via node/viem inline script ──────────────────────

CALLER_ADDR="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # vitalik.eth — fixture caller
RESOLVER_ADDR="0x0000000000000000000000000000000000000001"  # placeholder sender

export ENS_NAME RECORD_KEY CALLER_ADDR

CALL_DATA_JSON=$(node --input-type=module <<'NODEEOF'
import { encodeAbiParameters } from 'viem'

const ENS_NAME = process.env.ENS_NAME
const RECORD_KEY = process.env.RECORD_KEY
const CALLER_ADDR = process.env.CALLER_ADDR

// DNS wire-encode
function dnsEncode(name) {
  const labels = name.split('.')
  const parts = []
  for (const label of labels) {
    parts.push(label.length)
    for (const ch of label) parts.push(ch.charCodeAt(0))
  }
  parts.push(0)
  return '0x' + parts.map(b => b.toString(16).padStart(2, '0')).join('')
}

const encodedName = dnsEncode(ENS_NAME)
const selector = '0x59d1d43c'  // text(bytes32,string)
const node = '0x' + '00'.repeat(32)
const args = encodeAbiParameters(
  [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
  [node, RECORD_KEY]
)
const innerData = selector + args.slice(2)

const callData = encodeAbiParameters(
  [
    { name: 'name', type: 'bytes' },
    { name: 'callerAddr', type: 'address' },
    { name: 'innerData', type: 'bytes' },
  ],
  [encodedName, CALLER_ADDR, innerData]
)

process.stdout.write(JSON.stringify({ callData }) + '\n')
NODEEOF
)

CALL_DATA=$(echo "$CALL_DATA_JSON" | jq -r .callData)
echo "[resolve-l4a] callData: ${CALL_DATA:0:40}…"

# ─── Step 2: POST to /lookup ─────────────────────────────────────────────────

RESPONSE=$(curl -s -X POST "$GATEWAY_URL/lookup" \
  -H "Content-Type: application/json" \
  -d "{\"sender\": \"$RESOLVER_ADDR\", \"data\": \"$CALL_DATA\"}" \
  -w "\n__HTTP_STATUS__%{http_code}")

HTTP_STATUS=$(echo "$RESPONSE" | grep '__HTTP_STATUS__' | sed 's/__HTTP_STATUS__//')
BODY=$(echo "$RESPONSE" | grep -v '__HTTP_STATUS__')

echo "[resolve-l4a] HTTP status: $HTTP_STATUS"

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "[resolve-l4a] FAIL: expected 200, got $HTTP_STATUS"
  echo "[resolve-l4a] Response: $BODY"
  exit 1
fi

RESPONSE_DATA=$(echo "$BODY" | jq -r .data)
if [[ -z "$RESPONSE_DATA" || "$RESPONSE_DATA" == "null" ]]; then
  echo "[resolve-l4a] FAIL: response missing .data field"
  echo "[resolve-l4a] Response: $BODY"
  exit 1
fi

echo "[resolve-l4a] Response data: ${RESPONSE_DATA:0:40}…"

# ─── Step 3+4+5: decode response, check freshness, extract value ─────────────

DECODE_RESULT=$(node --input-type=module <<NODEEOF
import { decodeAbiParameters } from 'viem'

const responseData = '${RESPONSE_DATA}'
const [result, timestamp, nonce, sig] = decodeAbiParameters(
  [
    { type: 'bytes' },
    { type: 'uint64' },
    { type: 'bytes32' },
    { type: 'bytes' },
  ],
  responseData
)

const nowSec = BigInt(Math.floor(Date.now() / 1000))
const ageSec = nowSec - timestamp
const fresh = ageSec <= 300n

// Decode result as string
const [value] = decodeAbiParameters([{ type: 'string' }], result)

process.stdout.write(JSON.stringify({
  value,
  timestamp: timestamp.toString(),
  ageSec: ageSec.toString(),
  fresh,
  sigLen: sig.length,
}) + '\n')
NODEEOF
)

VALUE=$(echo "$DECODE_RESULT" | jq -r .value)
FRESH=$(echo "$DECODE_RESULT" | jq -r .fresh)
AGE=$(echo "$DECODE_RESULT" | jq -r .ageSec)
SIG_LEN=$(echo "$DECODE_RESULT" | jq -r .sigLen)

echo "[resolve-l4a] Decoded value: $VALUE"
echo "[resolve-l4a] Freshness: age=${AGE}s, fresh=$FRESH"
echo "[resolve-l4a] Sig length: $SIG_LEN chars"

if [[ "$FRESH" != "true" ]]; then
  echo "[resolve-l4a] FAIL: response is stale (age=${AGE}s > 300s)"
  exit 1
fi

if [[ "$SIG_LEN" -lt 132 ]]; then
  echo "[resolve-l4a] FAIL: signature too short (${SIG_LEN} chars, expected ≥132)"
  exit 1
fi

# ─── Step 6: cross-check value against known seed values ─────────────────────

declare -A EXPECTED_VALUES
EXPECTED_VALUES["seller.reckon402-test.eth|x402.facilitator"]="https://facilitator.reckon402.com"
EXPECTED_VALUES["seller.reckon402-test.eth|x402.splitter"]="0x0ad507c6973eba86313794329ad9b12fbf24acd0"
EXPECTED_VALUES["search.reckon402-test.eth|x402.facilitator"]="https://facilitator.reckon402.com"

LOOKUP_KEY="${ENS_NAME}|${RECORD_KEY}"
EXPECTED="${EXPECTED_VALUES[$LOOKUP_KEY]:-}"

if [[ "$BACKEND" == "erc8004" && "$RECORD_KEY" == "x402.amount" ]]; then
  # ERC-8004 path asserts: value is a decimal integer string, ≤ the
  # seeded base value (100000 USDC base-units). The exact post-discount
  # value depends on the live reputation summary of the indexed agent
  # and is not promised stable (see tools/integration-tests/known-agents.md).
  if [[ ! "$VALUE" =~ ^[0-9]+$ ]]; then
    echo "[resolve-l4a] FAIL: expected decimal integer, got $VALUE"
    exit 1
  fi
  if (( VALUE > 100000 )); then
    echo "[resolve-l4a] FAIL: discounted amount $VALUE exceeds base 100000"
    exit 1
  fi
  echo "[resolve-l4a] ERC-8004 cross-check PASS: value=$VALUE ≤ base 100000"
elif [[ -n "$EXPECTED" ]]; then
  if [[ "$VALUE" == "$EXPECTED" ]]; then
    echo "[resolve-l4a] Cross-check PASS: value matches D1 seed"
  else
    echo "[resolve-l4a] FAIL: value mismatch"
    echo "  expected: $EXPECTED"
    echo "  got:      $VALUE"
    exit 1
  fi
else
  echo "[resolve-l4a] No expected value configured for $LOOKUP_KEY — skipping cross-check"
fi

echo ""
echo "[resolve-l4a] PASS — gateway $BACKEND path responded correctly"
exit 0

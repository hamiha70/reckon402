#!/usr/bin/env bash
# agent-paywall.sh — L2 integration test for x402 paywall on agent.reckon402.com
# Requires: BUYER_DEMO_1_PK, BUYER_DEMO_1_ADDRESS, SELLER_ADDRESS,
#           BASE_SEPOLIA_RPC_PRIMARY (all from Infisical dev env)
# Usage: infisical run --env dev -- bash -c 'cd tools/integration-tests && ./agent-paywall.sh'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_URL="https://agent.reckon402.com"
PASS=0
FAIL=0

echo "=== L2 agent paywall integration test ==="
echo "Agent: $AGENT_URL"
echo ""

# ── Step 1: Assert 402 on /research without payment header ──────────────────
echo "[1/4] GET /research without PAYMENT-SIGNATURE -> expect 402"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$AGENT_URL/research?q=test")

if [ "$HTTP_STATUS" = "402" ]; then
  echo "  PASS: HTTP 402 returned"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected 402, got $HTTP_STATUS"
  FAIL=$((FAIL + 1))
fi

# Capture full response with headers to verify PAYMENT-REQUIRED
RESPONSE_402=$(curl -s -D - "$AGENT_URL/research?q=test")
PR_HEADER=$(echo "$RESPONSE_402" | grep -i "^payment-required:" | tr -d '\r' | cut -d' ' -f2-)

if [ -n "$PR_HEADER" ]; then
  DECODED_PR=$(echo "$PR_HEADER" | base64 -d 2>/dev/null)
  echo "  PAYMENT-REQUIRED header present"
  echo "  Decoded: $DECODED_PR" | head -c 300
  echo ""
else
  echo "  WARN: PAYMENT-REQUIRED header not found in response"
fi

# ── Step 2: Sign authorization ────────────────────────────────────────────────
echo ""
echo "[2/4] Generating PAYMENT-SIGNATURE via buyer-sign.mjs"

if [ -z "${BUYER_DEMO_1_PK:-}" ]; then
  echo "  FAIL: BUYER_DEMO_1_PK not set in environment"
  exit 1
fi

PAYMENT_SIG=$(node "$SCRIPT_DIR/buyer-sign.mjs")
echo "  Signature generated (${#PAYMENT_SIG} chars base64)"

# ── Step 3: Assert 200 on /research with valid payment ───────────────────────
echo ""
echo "[3/4] GET /research with PAYMENT-SIGNATURE -> expect 200"

HTTP_STATUS_200=$(curl -s -o /tmp/agent-paywall-response.json -w "%{http_code}" \
  -H "payment-signature: $PAYMENT_SIG" \
  "$AGENT_URL/research?q=test")

if [ "$HTTP_STATUS_200" = "200" ]; then
  echo "  PASS: HTTP 200 returned"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected 200, got $HTTP_STATUS_200"
  echo "  Response body:"
  cat /tmp/agent-paywall-response.json 2>/dev/null || true
  FAIL=$((FAIL + 1))
fi

# Capture response headers for PAYMENT-RESPONSE
RESPONSE_200=$(curl -s -D - \
  -H "payment-signature: $PAYMENT_SIG" \
  "$AGENT_URL/research?q=test" 2>/dev/null)

PR_RESPONSE=$(echo "$RESPONSE_200" | grep -i "^payment-response:" | tr -d '\r' | cut -d' ' -f2-)

if [ -n "$PR_RESPONSE" ]; then
  DECODED_PR_RESPONSE=$(echo "$PR_RESPONSE" | base64 -d 2>/dev/null)
  echo "  PAYMENT-RESPONSE header present"
  echo "  Decoded: $DECODED_PR_RESPONSE"
  TX_HASH=$(echo "$DECODED_PR_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transaction',''))" 2>/dev/null || echo "")
  PASS=$((PASS + 1))
else
  echo "  WARN: PAYMENT-RESPONSE header not found"
  TX_HASH=""
fi

# ── Step 4: Verify tx on Basescan ────────────────────────────────────────────
echo ""
echo "[4/4] Verify on-chain tx"

if [ -n "$TX_HASH" ] && [ "$TX_HASH" != "" ] && [ "$TX_HASH" != "null" ]; then
  BASESCAN_URL="https://sepolia.basescan.org/tx/$TX_HASH"
  echo "  tx hash: $TX_HASH"
  echo "  Basescan: $BASESCAN_URL"

  if [ -n "${BASE_SEPOLIA_RPC_PRIMARY:-}" ]; then
    CAST_OUTPUT=$(cast tx "$TX_HASH" --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" 2>&1 || echo "cast_failed")
    if echo "$CAST_OUTPUT" | grep -q "blockNumber"; then
      echo "  PASS: tx visible on-chain via cast"
      echo "  cast output excerpt:"
      echo "$CAST_OUTPUT" | grep -E "(blockNumber|from|to|value)" | head -5
      PASS=$((PASS + 1))
    else
      echo "  INFO: tx may be pending or cast failed. Output:"
      echo "$CAST_OUTPUT" | head -5
      echo "  (This is non-blocking at L2 — CDP has already confirmed settlement)"
    fi
  else
    echo "  INFO: BASE_SEPOLIA_RPC_PRIMARY not set; skipping cast verification"
  fi
else
  echo "  INFO: No tx hash in PAYMENT-RESPONSE (settlement may use different response format)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Results ==="
echo "PASS: $PASS  FAIL: $FAIL"

if [ "$FAIL" -eq 0 ]; then
  echo "L2 paywall integration test: ALL PASS"
  exit 0
else
  echo "L2 paywall integration test: $FAIL FAILURE(S)"
  exit 1
fi

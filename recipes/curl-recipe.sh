#!/usr/bin/env bash
# curl-recipe.sh — pay agent.reckon402.com/research via signing.reckon402.com/sign
#
# Prerequisites:
#   - SIGNING_WRAPPER_API_KEY set (from Infisical or env)
#   - curl, jq, python3
#
# Usage:
#   SIGNING_WRAPPER_API_KEY=<key> bash curl-recipe.sh
#
# What you'll see:
#   paymentId printed, state progressing SUBMITTED → CONFIRMED → RECONCILED,
#   and a final receipt JSON.

set -euo pipefail

SIGNING_URL="${SIGNING_URL:-https://signing.reckon402.com/sign}"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
MERCHANT_URL="${MERCHANT_URL:-https://agent.reckon402.com/research?q=hello}"
BUYER_EOA="0x46bbb05aca9ea24118b8a57c8d3f317503384305"
SPLITTER="0x0ad507c6973eba86313794329ad9b12fbf24acd0"
USDC_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
CHAIN_ID=84532
AMOUNT="10000"   # 0.01 USDC (6 decimals)

if [ -z "${SIGNING_WRAPPER_API_KEY:-}" ]; then
  echo "Error: SIGNING_WRAPPER_API_KEY not set" >&2
  exit 1
fi

NOW=$(date +%s)
VALID_BEFORE=$((NOW + 600))
NONCE="0x$(openssl rand -hex 32)"

echo "=== Step 1: Sign EIP-3009 authorization via signing wrapper ==="
SIGN_RESP=$(curl -sf -X POST "$SIGNING_URL" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SIGNING_WRAPPER_API_KEY" \
  --data "$(python3 -c "
import json,sys
print(json.dumps({
  'typedData': {
    'domain': {'name':'USD Coin','version':'2','chainId':$CHAIN_ID,'verifyingContract':'$USDC_SEPOLIA'},
    'types': {'TransferWithAuthorization': [
      {'name':'from','type':'address'},{'name':'to','type':'address'},
      {'name':'value','type':'uint256'},{'name':'validAfter','type':'uint256'},
      {'name':'validBefore','type':'uint256'},{'name':'nonce','type':'bytes32'}
    ]},
    'primaryType': 'TransferWithAuthorization',
    'message': {
      'from':'$BUYER_EOA','to':'$SPLITTER',
      'value':'$AMOUNT','validAfter':'0',
      'validBefore':'$VALID_BEFORE','nonce':'$NONCE'
    }
  }
}))
")")

SIGNATURE=$(echo "$SIGN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['signature'])")
echo "Signature: ${SIGNATURE:0:20}..."

echo ""
echo "=== Step 2: POST to merchant with payment headers ==="
MERCHANT_RESP=$(curl -sf "$MERCHANT_URL" \
  -H "X-PAYMENT-AUTHORIZATION: $(python3 -c "
import json
print(json.dumps({'from':'$BUYER_EOA','to':'$SPLITTER','value':'$AMOUNT',
  'validAfter':'0','validBefore':'$VALID_BEFORE','nonce':'$NONCE',
  'version':2,'network':'eip155:84532'}))
")" \
  -H "X-PAYMENT-SIGNATURE: $SIGNATURE" \
  -D /tmp/merchant-headers.txt 2>/dev/null || true)

PAYMENT_ID=$(grep -i "x-payment-id" /tmp/merchant-headers.txt 2>/dev/null | awk '{print $2}' | tr -d '\r' || echo "")
if [ -z "$PAYMENT_ID" ]; then
  echo "Merchant response (may include paymentId in body):"
  echo "$MERCHANT_RESP" | python3 -m json.tool 2>/dev/null || echo "$MERCHANT_RESP"
  PAYMENT_ID=$(echo "$MERCHANT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('paymentId',''))" 2>/dev/null || echo "")
fi
echo "paymentId: $PAYMENT_ID"

if [ -z "$PAYMENT_ID" ]; then
  echo "No paymentId found — merchant may have returned error" >&2
  exit 1
fi

echo ""
echo "=== Step 3: Poll receipt until RECONCILED ==="
STATE="SUBMITTED"
while ! [[ "$STATE" == "RECONCILED" || "$STATE" == "FAILED" ]]; do
  sleep 1
  RECEIPT=$(curl -sf "$FACILITATOR_URL/x402/receipt/$PAYMENT_ID" 2>/dev/null || echo '{"state":"PENDING"}')
  STATE=$(echo "$RECEIPT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state','UNKNOWN'))" 2>/dev/null)
  echo "  $(date -u +%H:%M:%S)  state=$STATE"
done

echo ""
echo "Final receipt:"
echo "$RECEIPT" | python3 -m json.tool

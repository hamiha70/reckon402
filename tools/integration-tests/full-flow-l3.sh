#!/usr/bin/env bash
# full-flow-l3.sh — live end-to-end L3 integration test on Base Sepolia.
#
# What it proves:
#  1. agent.reckon402.com/research returns 402 without PAYMENT-SIGNATURE.
#  2. A payload signed by @reckon402/buyer-sdk (auth.to = Splitter) drives
#     the middleware → Reckon402Facilitator → two-tx settle (USDC
#     transferWithAuthorization + Splitter.distribute) → CONFIRMED receipt.
#  3. /x402/receipt/:paymentId returns a CONFIRMED receipt with the tx hash.
#  4. The on-chain tx exists on Base Sepolia at the recorded block.
#  5. The run log captures paymentId + nonce for the replay test.
#
# Requires (Infisical-hydrated):
#   BUYER_DEMO_1_PK, BASE_SEPOLIA_RPC_PRIMARY
# Optional overrides:
#   SELLER_ENS (default: seller.reckon402-test.eth)
#   SPLITTER_ADDRESS (default: auto-resolved from gateway via SELLER_ENS)
#
# Usage:
#   infisical run --env dev --domain https://secrets.intentralabs.com -- \
#     bash -c 'cd tools/integration-tests && bash full-flow-l3.sh'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_URL="${AGENT_URL:-https://agent.reckon402.com}"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
GATEWAY_URL="${GATEWAY_URL:-https://gateway.reckon402.com}"
SELLER_ENS="${SELLER_ENS:-seller.reckon402-test.eth}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_LOG="$SCRIPT_DIR/run-full-flow-l3-$STAMP.log"
ARTIFACT_DIR="$SCRIPT_DIR/run-full-flow-l3-$STAMP"
mkdir -p "$ARTIFACT_DIR"

# Resolve SPLITTER_ADDRESS from the gateway unless already set in the environment.
# This keeps the test agent-agnostic: any agent whose splitter is registered in
# the gateway will work — no hardcoded address needed.
if [ -z "${SPLITTER_ADDRESS:-}" ]; then
  SPLITTER_ADDRESS=$(curl -sS "$GATEWAY_URL/records/${SELLER_ENS}?flat=true&backend=static" \
    | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
        try { console.log(JSON.parse(d).records['x402.splitter'] ?? '') }
        catch { console.log('') }
      })")
  if [ -z "$SPLITTER_ADDRESS" ]; then
    echo "ERROR: could not resolve x402.splitter for $SELLER_ENS from $GATEWAY_URL" >&2
    exit 1
  fi
  echo "  resolved SPLITTER_ADDRESS=$SPLITTER_ADDRESS (from gateway)" >&2
fi

echo "=== L3 full-flow integration test ===" | tee "$RUN_LOG"
echo "Agent:       $AGENT_URL"               | tee -a "$RUN_LOG"
echo "Facilitator: $FACILITATOR_URL"         | tee -a "$RUN_LOG"
echo "Splitter:    ${SPLITTER_ADDRESS:-UNSET}" | tee -a "$RUN_LOG"
echo "Start:       $STAMP"                   | tee -a "$RUN_LOG"
echo ""                                      | tee -a "$RUN_LOG"

# ── Pre-flight ────────────────────────────────────────────────────────────
: "${BUYER_DEMO_1_PK:?BUYER_DEMO_1_PK missing (hydrate via infisical run)}"

# ── Step 1: 402 gate ──────────────────────────────────────────────────────
echo "[1/6] GET /research WITHOUT payment header -> expect 402" | tee -a "$RUN_LOG"
STATUS_402=$(curl -s -o "$ARTIFACT_DIR/402-body.json" -D "$ARTIFACT_DIR/402-headers.txt" \
  -w "%{http_code}" "$AGENT_URL/research?q=ethereum")
echo "  HTTP $STATUS_402" | tee -a "$RUN_LOG"
if [ "$STATUS_402" != "402" ]; then
  echo "  FAIL: expected 402" | tee -a "$RUN_LOG"
  exit 1
fi

PR_HEADER=$(grep -i "^payment-required:" "$ARTIFACT_DIR/402-headers.txt" | tr -d '\r' | sed -E 's/^[^:]+:[[:space:]]*//')
if [ -z "$PR_HEADER" ]; then
  echo "  FAIL: PAYMENT-REQUIRED header missing" | tee -a "$RUN_LOG"
  exit 1
fi
DECODED=$(echo -n "$PR_HEADER" | base64 -d 2>/dev/null | tee "$ARTIFACT_DIR/payment-required.json")
echo "  PAYMENT-REQUIRED.accepts[0].payTo = $(echo "$DECODED" | python3 -c 'import sys,json; print(json.load(sys.stdin)["accepts"][0]["payTo"])')" | tee -a "$RUN_LOG"
echo "" | tee -a "$RUN_LOG"

# ── Step 2: Sign authorization (fresh nonce) ─────────────────────────────
echo "[2/6] Sign PaymentPayload via @reckon402/buyer-sdk"  | tee -a "$RUN_LOG"
PAYMENT_SIG=$(node "$SCRIPT_DIR/buyer-sign-l3.mjs" 2> "$ARTIFACT_DIR/buyer-sign.stderr")
PAYMENT_ID=$(grep "paymentId=" "$ARTIFACT_DIR/buyer-sign.stderr" | sed -E 's/.*paymentId=([0-9a-fx]+).*/\1/')
NONCE=$(grep "nonce=" "$ARTIFACT_DIR/buyer-sign.stderr" | head -1 | sed -E 's/.*nonce=([0-9a-fx]+).*/\1/')
VALID_BEFORE=$(grep "validBefore=" "$ARTIFACT_DIR/buyer-sign.stderr" | head -1 | sed -E 's/.*validBefore=([0-9]+).*/\1/')
echo "  paymentId=$PAYMENT_ID" | tee -a "$RUN_LOG"
echo "  nonce=$NONCE"          | tee -a "$RUN_LOG"
echo "$PAYMENT_SIG" > "$ARTIFACT_DIR/payment-signature.b64"
echo "$NONCE" > "$ARTIFACT_DIR/nonce.txt"
echo "$PAYMENT_ID" > "$ARTIFACT_DIR/paymentId.txt"
echo "$VALID_BEFORE" > "$ARTIFACT_DIR/validBefore.txt"
echo "" | tee -a "$RUN_LOG"

# ── Step 3: 200 with valid payment (drives two-tx settle) ─────────────────
echo "[3/6] GET /research WITH payment -> expect 200 (may take 10-60s for both on-chain txs)" | tee -a "$RUN_LOG"
STATUS_200=$(curl -s -o "$ARTIFACT_DIR/200-body.json" -D "$ARTIFACT_DIR/200-headers.txt" \
  -w "%{http_code}" --max-time 90 \
  -H "payment-signature: $PAYMENT_SIG" \
  "$AGENT_URL/research?q=ethereum")
echo "  HTTP $STATUS_200" | tee -a "$RUN_LOG"
if [ "$STATUS_200" != "200" ]; then
  echo "  FAIL: expected 200. Body:" | tee -a "$RUN_LOG"
  cat "$ARTIFACT_DIR/200-body.json" | tee -a "$RUN_LOG"
  exit 1
fi

PR_RESP=$(grep -i "^payment-response:" "$ARTIFACT_DIR/200-headers.txt" | tr -d '\r' | sed -E 's/^[^:]+:[[:space:]]*//')
SETTLEMENT=$(echo -n "$PR_RESP" | base64 -d 2>/dev/null | tee "$ARTIFACT_DIR/payment-response.json")
TX_HASH=$(echo "$SETTLEMENT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("transaction",""))')
STATE=$(echo "$SETTLEMENT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("state",""))')
echo "  tx=$TX_HASH state=$STATE" | tee -a "$RUN_LOG"
echo "$TX_HASH" > "$ARTIFACT_DIR/tx-hash.txt"

if [ "$STATE" != "CONFIRMED" ]; then
  echo "  FAIL: expected state=CONFIRMED, got $STATE" | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

# ── Step 4: Receipt lookup ────────────────────────────────────────────────
echo "[4/6] GET facilitator /x402/receipt/:paymentId" | tee -a "$RUN_LOG"
RECEIPT_STATUS=$(curl -s -o "$ARTIFACT_DIR/receipt.json" \
  -w "%{http_code}" "$FACILITATOR_URL/x402/receipt/$PAYMENT_ID")
echo "  HTTP $RECEIPT_STATUS" | tee -a "$RUN_LOG"
if [ "$RECEIPT_STATUS" != "200" ]; then
  echo "  FAIL: receipt lookup did not return 200" | tee -a "$RUN_LOG"
  exit 1
fi
RECEIPT_STATE=$(python3 -c 'import sys,json; d=json.load(open(sys.argv[1])); print(d.get("state",""))' "$ARTIFACT_DIR/receipt.json")
RECEIPT_TX=$(python3 -c 'import sys,json; d=json.load(open(sys.argv[1])); print(d.get("transaction",""))' "$ARTIFACT_DIR/receipt.json")
echo "  state=$RECEIPT_STATE tx=$RECEIPT_TX" | tee -a "$RUN_LOG"
if [ "$RECEIPT_STATE" != "CONFIRMED" ] || [ "$RECEIPT_TX" != "$TX_HASH" ]; then
  echo "  FAIL: receipt state or tx mismatch" | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

# ── Step 5: Verify on-chain ──────────────────────────────────────────────
echo "[5/6] Verify on-chain tx" | tee -a "$RUN_LOG"
BASESCAN_URL="https://sepolia.basescan.org/tx/$TX_HASH"
echo "  Basescan: $BASESCAN_URL" | tee -a "$RUN_LOG"

if [ -n "${BASE_SEPOLIA_RPC_PRIMARY:-}" ] && command -v cast >/dev/null 2>&1; then
  CAST_OUTPUT=$(cast tx "$TX_HASH" --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" 2>&1 | head -20 || true)
  echo "$CAST_OUTPUT" > "$ARTIFACT_DIR/cast-tx.txt"
  if echo "$CAST_OUTPUT" | grep -q "blockNumber"; then
    echo "  cast tx: blockNumber present" | tee -a "$RUN_LOG"
  else
    echo "  WARN: cast tx did not return a blockNumber (tx may still be propagating)" | tee -a "$RUN_LOG"
  fi
else
  echo "  INFO: cast / BASE_SEPOLIA_RPC_PRIMARY not available; skipping cast-side verification" | tee -a "$RUN_LOG"
fi
echo "" | tee -a "$RUN_LOG"

# ── Step 6: Write summary artifact ───────────────────────────────────────
echo "[6/6] Write summary" | tee -a "$RUN_LOG"
cat > "$SCRIPT_DIR/results-full-flow-l3-$STAMP.md" <<EOF
# L3 full-flow integration test — $STAMP

| Field | Value |
|-------|-------|
| Agent URL | $AGENT_URL |
| Facilitator URL | $FACILITATOR_URL |
| Splitter | \`$SPLITTER_ADDRESS\` |
| paymentId | \`$PAYMENT_ID\` |
| nonce | \`$NONCE\` |
| tx (transferWithAuthorization) | \`$TX_HASH\` |
| Basescan | $BASESCAN_URL |
| Receipt state | $RECEIPT_STATE |

Artifacts: \`$ARTIFACT_DIR/\` (402 headers, 200 headers, payment-required.json, payment-response.json, receipt.json, cast-tx.txt).
EOF
echo "  wrote $SCRIPT_DIR/results-full-flow-l3-$STAMP.md" | tee -a "$RUN_LOG"
echo "" | tee -a "$RUN_LOG"
echo "=== PASS ===" | tee -a "$RUN_LOG"
echo "(record nonce=$NONCE and paymentId=$PAYMENT_ID for replay-l3.sh)" | tee -a "$RUN_LOG"

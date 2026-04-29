#!/usr/bin/env bash
# demo-e2e.sh — Reckon402 testnet dress-rehearsal e2e demo script.
#
# Runs a three-call sequence demonstrating ERC-8004 reputation growth
# and tier-based discount pricing on Base Sepolia.
#
# Call 1 — Baseline: buyer calls agent → 402 → pays → CONFIRMED receipt.
# Call 2 — Reputation write: verify ERC-8004 attestation written
#           (attestations row in D1 + facilitator receipt has td_erc8004_tx).
# Call 3 — Price tier: re-resolve seller ENS via gateway, confirm
#           x402.amount is lower than Call 1 baseline.
#
# Usage (secrets from Infisical):
#   infisical run --env dev --domain https://secrets.intentralabs.com -- \
#     bash -c 'bash scripts/demo-e2e.sh'
#
# Required env vars (injected by Infisical):
#   BUYER_DEMO_1_PK, SPLITTER_ADDRESS, BASE_SEPOLIA_RPC_PRIMARY
#
# Optional overrides:
#   AGENT_URL, FACILITATOR_URL, GATEWAY_URL, SELLER_NAME

set -euo pipefail

# TODO-NARRATIVE: Insert demo voiceover hook here

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INTEGRATION_DIR="$REPO_ROOT/tools/integration-tests"

AGENT_URL="${AGENT_URL:-https://agent.reckon402.com}"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
GATEWAY_URL="${GATEWAY_URL:-https://gateway.reckon402.com}"
SELLER_NAME="${SELLER_NAME:-seller.reckon402-test.eth}"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARTIFACT_DIR="$REPO_ROOT/tmp/demo-e2e-$STAMP"
mkdir -p "$ARTIFACT_DIR"

# ── Color helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

ts() { date -u +%H:%M:%S; }

pass()  { echo -e "${GREEN}[$(ts)] $*${RESET}"; }
warn()  { echo -e "${YELLOW}[$(ts)] $*${RESET}"; }
fail()  { echo -e "${RED}[$(ts)] FAIL: $*${RESET}"; }
info()  { echo -e "${CYAN}[$(ts)] $*${RESET}"; }
step()  { echo -e "\n${CYAN}[$(ts)] [$1] $2${RESET}"; }

die() {
  fail "$1"
  if [ -f "$ARTIFACT_DIR/last-response.json" ]; then
    echo -e "${RED}--- Response body ---${RESET}"
    cat "$ARTIFACT_DIR/last-response.json"
    echo -e "${RED}---------------------${RESET}"
  fi
  exit 1
}

info "Reckon402 demo e2e — $STAMP"
info "Agent:       $AGENT_URL"
info "Facilitator: $FACILITATOR_URL"
info "Gateway:     $GATEWAY_URL"
info "Seller ENS:  $SELLER_NAME"
info "Artifacts:   $ARTIFACT_DIR"

# ── Pre-flight ─────────────────────────────────────────────────────────────────
: "${BUYER_DEMO_1_PK:?BUYER_DEMO_1_PK missing — hydrate via infisical run}"
: "${SPLITTER_ADDRESS:?SPLITTER_ADDRESS missing}"

# ──────────────────────────────────────────────────────────────────────────────
# CALL 1 — Baseline settlement
# ──────────────────────────────────────────────────────────────────────────────

step "1/8" "Snapshot baseline x402.amount via ENS gateway (erc8004 backend)"
BEFORE_JSON="$ARTIFACT_DIR/c1-before-amount.json"
set +e
bash "$INTEGRATION_DIR/resolve-l4a.sh" \
  --backend erc8004 \
  --gateway "$GATEWAY_URL" \
  --name "$SELLER_NAME" \
  --key x402.amount 2>&1 | tee "$BEFORE_JSON"
RESOLVE_EXIT=$?
set -e
BEFORE_AMOUNT=$(grep -oE '"value":"[0-9]+"' "$BEFORE_JSON" | head -1 \
  | sed -E 's/.*"([0-9]+)".*/\1/' || echo "UNKNOWN")
if [ "$BEFORE_AMOUNT" = "UNKNOWN" ]; then
  warn "Could not parse x402.amount from gateway; proceeding with UNKNOWN baseline"
else
  info "  x402.amount BASELINE = $BEFORE_AMOUNT ($(echo "scale=4; $BEFORE_AMOUNT / 1000000" | bc) USDC)"
fi

step "2/8" "GET /research WITHOUT payment header — expect 402"
STATUS_402=$(curl -s -o "$ARTIFACT_DIR/c1-402-body.json" \
  -D "$ARTIFACT_DIR/c1-402-headers.txt" \
  -w "%{http_code}" \
  "$AGENT_URL/research?q=demo-call1")
cp "$ARTIFACT_DIR/c1-402-body.json" "$ARTIFACT_DIR/last-response.json"
info "  HTTP $STATUS_402"
[ "$STATUS_402" = "402" ] || die "Expected HTTP 402, got $STATUS_402"
pass "  402 gate active"

step "3/8" "Sign PaymentPayload via @reckon402/buyer-sdk"
PAYMENT_SIG=$(node "$INTEGRATION_DIR/buyer-sign-l3.mjs" \
  2> "$ARTIFACT_DIR/c1-buyer-sign.stderr")
PAYMENT_ID=$(grep "paymentId=" "$ARTIFACT_DIR/c1-buyer-sign.stderr" \
  | sed -E 's/.*paymentId=([0-9a-fx]+).*/\1/' | head -1)
NONCE=$(grep "nonce=" "$ARTIFACT_DIR/c1-buyer-sign.stderr" \
  | head -1 | sed -E 's/.*nonce=([0-9a-fx]+).*/\1/')
echo "$PAYMENT_SIG" > "$ARTIFACT_DIR/c1-payment-signature.b64"
echo "$PAYMENT_ID" > "$ARTIFACT_DIR/c1-paymentId.txt"
[ -n "$PAYMENT_ID" ] || die "Could not parse paymentId from buyer-sdk"
info "  paymentId = $PAYMENT_ID"
info "  nonce     = $NONCE"
pass "  PaymentPayload signed"

step "4/8" "GET /research WITH payment — expect 200 + CONFIRMED state"
warn "  Waiting for two on-chain txs (may take 15–60s)..."
STATUS_200=$(curl -s -o "$ARTIFACT_DIR/c1-200-body.json" \
  -D "$ARTIFACT_DIR/c1-200-headers.txt" \
  -w "%{http_code}" --max-time 90 \
  -H "payment-signature: $PAYMENT_SIG" \
  "$AGENT_URL/research?q=demo-call1")
cp "$ARTIFACT_DIR/c1-200-body.json" "$ARTIFACT_DIR/last-response.json"
info "  HTTP $STATUS_200"
[ "$STATUS_200" = "200" ] || die "Expected HTTP 200, got $STATUS_200"

PR_RESP=$(grep -i "^payment-response:" "$ARTIFACT_DIR/c1-200-headers.txt" \
  | tr -d '\r' | sed -E 's/^[^:]+:[[:space:]]*//')
SETTLEMENT=$(echo -n "$PR_RESP" | base64 -d 2>/dev/null \
  | tee "$ARTIFACT_DIR/c1-payment-response.json")
TX_HASH=$(echo "$SETTLEMENT" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("transaction",""))')
STATE=$(echo "$SETTLEMENT" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("state",""))')
echo "$TX_HASH" > "$ARTIFACT_DIR/c1-tx-hash.txt"
info "  tx    = $TX_HASH"
info "  state = $STATE"
[ "$STATE" = "CONFIRMED" ] || die "Expected state=CONFIRMED, got $STATE"
pass "  Settlement CONFIRMED"
info "  Basescan: https://sepolia.basescan.org/tx/$TX_HASH"

# ──────────────────────────────────────────────────────────────────────────────
# CALL 2 — Reputation write verification
# ──────────────────────────────────────────────────────────────────────────────

step "5/8" "Verify ERC-8004 attestation written (poll receipt for td_erc8004_tx)"
MAX_WAIT=90
WAITED=0
RECEIPT_JSON="$ARTIFACT_DIR/c2-receipt.json"
TD_TX=""
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  curl -s -o "$RECEIPT_JSON" \
    "$FACILITATOR_URL/x402/receipt/$PAYMENT_ID" || true
  TD_TX=$(python3 -c \
    'import sys,json; d=json.load(open(sys.argv[1])); r=d.get("receipt",{}); print(r.get("tdErc8004Tx") or r.get("td_erc8004_tx") or d.get("tdErc8004Tx") or d.get("td_erc8004_tx") or "")' \
    "$RECEIPT_JSON" 2>/dev/null || echo "")
  if [ -n "$TD_TX" ] && [ "$TD_TX" != "null" ] && [ "$TD_TX" != "FAILED" ]; then
    break
  fi
  warn "  Waiting for attestation... (${WAITED}s elapsed)"
  sleep 3
  WAITED=$((WAITED + 3))
done
cp "$RECEIPT_JSON" "$ARTIFACT_DIR/last-response.json"

if [ -z "$TD_TX" ] || [ "$TD_TX" = "null" ] || [ "$TD_TX" = "FAILED" ]; then
  die "Attestation tx did not land in D1 within ${MAX_WAIT}s. Check wrangler tail for maybeWriteAttestation errors."
fi
info "  td_erc8004_tx = $TD_TX (after ${WAITED}s)"
pass "  ERC-8004 attestation confirmed"
info "  Basescan (attestation): https://sepolia.basescan.org/tx/$TD_TX"

# ──────────────────────────────────────────────────────────────────────────────
# CALL 3 — Price tier discount
# ──────────────────────────────────────────────────────────────────────────────

step "6/8" "Wait 3s for gateway cache-invalidate to propagate"
sleep 3

step "7/8" "Re-resolve x402.amount via ENS gateway — expect lower price after attestation"
AFTER_JSON="$ARTIFACT_DIR/c3-after-amount.json"
set +e
bash "$INTEGRATION_DIR/resolve-l4a.sh" \
  --backend erc8004 \
  --gateway "$GATEWAY_URL" \
  --name "$SELLER_NAME" \
  --key x402.amount 2>&1 | tee "$AFTER_JSON"
set -e
AFTER_AMOUNT=$(grep -oE '"value":"[0-9]+"' "$AFTER_JSON" | head -1 \
  | sed -E 's/.*"([0-9]+)".*/\1/' || echo "UNKNOWN")
info "  x402.amount AFTER = $AFTER_AMOUNT"

if [[ "$BEFORE_AMOUNT" =~ ^[0-9]+$ ]] && [[ "$AFTER_AMOUNT" =~ ^[0-9]+$ ]]; then
  BEFORE_USDC=$(echo "scale=6; $BEFORE_AMOUNT / 1000000" | bc)
  AFTER_USDC=$(echo "scale=6; $AFTER_AMOUNT / 1000000" | bc)
  info "  BEFORE: ${BEFORE_AMOUNT} μUSDC (${BEFORE_USDC} USDC)"
  info "  AFTER:  ${AFTER_AMOUNT} μUSDC (${AFTER_USDC} USDC)"
  if [ "$AFTER_AMOUNT" -lt "$BEFORE_AMOUNT" ]; then
    DISCOUNT=$(echo "scale=2; (1 - $AFTER_AMOUNT / $BEFORE_AMOUNT) * 100" | bc)
    pass "  Price tier discount engaged: ${BEFORE_AMOUNT} → ${AFTER_AMOUNT} (${DISCOUNT}% off)"
  elif [ "$AFTER_AMOUNT" -eq "$BEFORE_AMOUNT" ]; then
    warn "  Same price tier (BEFORE=$BEFORE_AMOUNT == AFTER=$AFTER_AMOUNT). Tier threshold not yet crossed on this agent."
  else
    warn "  AFTER ($AFTER_AMOUNT) > BEFORE ($BEFORE_AMOUNT) — unexpected. Check gateway cache invalidation."
  fi
else
  warn "  Could not compare amounts (BEFORE=$BEFORE_AMOUNT AFTER=$AFTER_AMOUNT); verify manually."
fi

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────

step "8/8" "Write summary artifact"
SUMMARY_FILE="$ARTIFACT_DIR/summary.md"
cat > "$SUMMARY_FILE" <<EOF
# Demo e2e — $STAMP

| Field | Value |
|-------|-------|
| Agent | $AGENT_URL |
| Facilitator | $FACILITATOR_URL |
| Gateway | $GATEWAY_URL |
| Seller ENS | $SELLER_NAME |
| paymentId | \`$PAYMENT_ID\` |
| settlement tx | \`$TX_HASH\` |
| attestation tx | \`$TD_TX\` |
| x402.amount BEFORE | \`${BEFORE_AMOUNT:-UNKNOWN}\` |
| x402.amount AFTER  | \`${AFTER_AMOUNT:-UNKNOWN}\` |
| Basescan (settlement) | https://sepolia.basescan.org/tx/$TX_HASH |
| Basescan (attestation) | https://sepolia.basescan.org/tx/$TD_TX |
EOF
info "  Summary: $SUMMARY_FILE"
echo ""
pass "=== DEMO E2E PASS ==="

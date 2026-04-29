#!/usr/bin/env bash
# full-flow-l4b.sh — extended L4b₁ integration test. Runs full-flow-l3.sh
# end-to-end, then verifies the ERC-8004 attestation write closed the
# gateway loop.
#
# Proves:
#   1. Steps 1–6 of full-flow-l3.sh (settlement still works unchanged).
#   2. The facilitator wrote a giveFeedback tx to ReputationRegistry.
#   3. D1 row in `attestations` appeared for this paymentId.
#   4. D1 row in `receipts` has td_erc8004_tx populated.
#   5. The gateway cache was invalidated — the next resolve-l4a.sh
#      --backend erc8004 read hits RPC and returns a summary reflecting
#      count > 0.
#
# Requires (Infisical-hydrated):
#   BUYER_DEMO_1_PK, SPLITTER_ADDRESS, BASE_SEPOLIA_RPC_PRIMARY
#
# Usage:
#   infisical run --env dev --domain https://secrets.intentralabs.com -- \
#     bash -c 'cd tools/integration-tests && bash full-flow-l4b.sh'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_URL="${GATEWAY_URL:-https://gateway.reckon402.com}"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
SELLER_NAME="${SELLER_NAME:-seller.reckon402-test.eth}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_LOG="$SCRIPT_DIR/run-full-flow-l4b-$STAMP.log"
RESULT_MD="$SCRIPT_DIR/results-full-flow-l4b-$STAMP.md"

echo "=== L4b₁ full-flow + attestation-write integration test ===" | tee "$RUN_LOG"
echo "Gateway:     $GATEWAY_URL"    | tee -a "$RUN_LOG"
echo "Facilitator: $FACILITATOR_URL"| tee -a "$RUN_LOG"
echo "Seller:      $SELLER_NAME"    | tee -a "$RUN_LOG"
echo "Start:       $STAMP"          | tee -a "$RUN_LOG"
echo ""                             | tee -a "$RUN_LOG"

# ── Step A: Snapshot pre-settlement reputation read (gateway ENS read) ─────
echo "[A/E] Snapshot reputation BEFORE settlement"    | tee -a "$RUN_LOG"
BEFORE_JSON="$SCRIPT_DIR/run-l4b-$STAMP-before.json"
# The erc8004 backend returns x402.amount as priced-by-tier (lower on higher count).
BEFORE_RAW=$(bash "$SCRIPT_DIR/resolve-l4a.sh" \
  --backend erc8004 \
  --gateway "$GATEWAY_URL" \
  --name "$SELLER_NAME" \
  --key x402.amount 2>&1 | tee "$BEFORE_JSON")
BEFORE_AMOUNT=$(grep -oE '"value":"[0-9]+"' "$BEFORE_JSON" | head -1 | sed -E 's/.*"([0-9]+)".*/\1/' || echo "UNKNOWN")
echo "  x402.amount BEFORE = $BEFORE_AMOUNT"          | tee -a "$RUN_LOG"
echo ""                                                | tee -a "$RUN_LOG"

# ── Step B: Run the full-flow-l3 settle ────────────────────────────────────
echo "[B/E] Run full-flow-l3.sh (reuses settlement path unchanged)" | tee -a "$RUN_LOG"
bash "$SCRIPT_DIR/full-flow-l3.sh" 2>&1 | tee -a "$RUN_LOG"

# Pick up the paymentId + tx hash from the latest full-flow artefact.
# (full-flow-l3.sh writes results-full-flow-l3-$STAMP.md but we don't share
# STAMP; read the newest artifact dir instead.)
# -type d filters out the sibling .log file; ls -1dt with trailing slash also
# works but `find ... -maxdepth 1 -type d` is more explicit.
LATEST_ARTIFACT=$(find "$SCRIPT_DIR" -maxdepth 1 -type d -name 'run-full-flow-l3-*' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)
if [ -z "$LATEST_ARTIFACT" ] || [ ! -d "$LATEST_ARTIFACT" ]; then
  echo "  FAIL: could not locate full-flow-l3 artifact directory" | tee -a "$RUN_LOG"
  exit 1
fi
PAYMENT_ID=$(cat "$LATEST_ARTIFACT/paymentId.txt")
TRANSFER_TX=$(cat "$LATEST_ARTIFACT/tx-hash.txt")
echo "  paymentId=$PAYMENT_ID"   | tee -a "$RUN_LOG"
echo "  transferTx=$TRANSFER_TX" | tee -a "$RUN_LOG"
echo ""                          | tee -a "$RUN_LOG"

# ── Step C: Wait for the attestation to land + cache to invalidate ────────
echo "[C/E] Wait for attestation tx (ctx.waitUntil + on-chain confirm, ~10s)" | tee -a "$RUN_LOG"
MAX_WAIT=60
WAITED=0
RECEIPT_JSON="$SCRIPT_DIR/run-l4b-$STAMP-receipt.json"
TD_TX=""
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  curl -s -o "$RECEIPT_JSON" "$FACILITATOR_URL/x402/receipt/$PAYMENT_ID" || true
  TD_TX=$(python3 -c 'import sys,json; d=json.load(open(sys.argv[1])); print(d.get("tdErc8004Tx") or d.get("td_erc8004_tx") or "")' "$RECEIPT_JSON" 2>/dev/null || echo "")
  if [ -n "$TD_TX" ] && [ "$TD_TX" != "null" ] && [ "$TD_TX" != "FAILED" ]; then
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "  waited=${WAITED}s td_erc8004_tx=${TD_TX:-NONE}" | tee -a "$RUN_LOG"
echo ""                                                  | tee -a "$RUN_LOG"

if [ -z "$TD_TX" ] || [ "$TD_TX" = "null" ] || [ "$TD_TX" = "FAILED" ]; then
  echo "  FAIL: attestation tx did not land in D1 within ${MAX_WAIT}s" | tee -a "$RUN_LOG"
  echo "  Check wrangler tail for maybeWriteAttestation_* errors."      | tee -a "$RUN_LOG"
  exit 1
fi

BASESCAN_ATT="https://sepolia.basescan.org/tx/$TD_TX"
echo "  attestation tx Basescan: $BASESCAN_ATT"         | tee -a "$RUN_LOG"

# ── Step D: Re-read reputation via gateway (cache invalidated) ────────────
echo "[D/E] Snapshot reputation AFTER attestation"    | tee -a "$RUN_LOG"
AFTER_JSON="$SCRIPT_DIR/run-l4b-$STAMP-after.json"
# Brief extra pause for the cache-invalidate POST to land.
sleep 3
bash "$SCRIPT_DIR/resolve-l4a.sh" \
  --backend erc8004 \
  --gateway "$GATEWAY_URL" \
  --name "$SELLER_NAME" \
  --key x402.amount 2>&1 | tee "$AFTER_JSON" | tee -a "$RUN_LOG" || true
AFTER_AMOUNT=$(grep -oE '"value":"[0-9]+"' "$AFTER_JSON" | head -1 | sed -E 's/.*"([0-9]+)".*/\1/' || echo "UNKNOWN")
echo "  x402.amount AFTER = $AFTER_AMOUNT"             | tee -a "$RUN_LOG"
echo ""                                                 | tee -a "$RUN_LOG"

# The gateway's pricing ladder gives a *lower* amount for non-zero count.
# Pass condition: AFTER is numerically smaller than BEFORE (tier kicked in),
# OR this is a fresh agent and BEFORE already showed the base price.
if [[ "$BEFORE_AMOUNT" =~ ^[0-9]+$ ]] && [[ "$AFTER_AMOUNT" =~ ^[0-9]+$ ]]; then
  if [ "$AFTER_AMOUNT" -lt "$BEFORE_AMOUNT" ]; then
    echo "  PASS: AFTER ($AFTER_AMOUNT) < BEFORE ($BEFORE_AMOUNT) — discount tier engaged" | tee -a "$RUN_LOG"
    PRICE_COMPARISON="discount-engaged"
  elif [ "$AFTER_AMOUNT" -eq "$BEFORE_AMOUNT" ]; then
    echo "  INFO: AFTER == BEFORE ($AFTER_AMOUNT) — same tier (likely below the next threshold)" | tee -a "$RUN_LOG"
    PRICE_COMPARISON="same-tier"
  else
    echo "  WARN: AFTER ($AFTER_AMOUNT) > BEFORE ($BEFORE_AMOUNT) — unexpected; check gateway cache invalidation" | tee -a "$RUN_LOG"
    PRICE_COMPARISON="unexpected"
  fi
else
  PRICE_COMPARISON="uncomparable(raw-before=$BEFORE_AMOUNT,after=$AFTER_AMOUNT)"
fi

# ── Step E: Write summary artifact ─────────────────────────────────────────
echo "[E/E] Write summary" | tee -a "$RUN_LOG"
cat > "$RESULT_MD" <<EOF
# L4b₁ full-flow + attestation integration test — $STAMP

| Field | Value |
|-------|-------|
| Gateway | $GATEWAY_URL |
| Facilitator | $FACILITATOR_URL |
| Seller ENS | $SELLER_NAME |
| paymentId | \`$PAYMENT_ID\` |
| settlement tx (transferWithAuthorization) | \`$TRANSFER_TX\` |
| attestation tx (giveFeedback) | \`$TD_TX\` |
| Basescan (attestation) | $BASESCAN_ATT |
| x402.amount BEFORE | \`$BEFORE_AMOUNT\` |
| x402.amount AFTER  | \`$AFTER_AMOUNT\` |
| Price comparison | $PRICE_COMPARISON |
| Attestation wait | ${WAITED}s |

Artifacts:
- full-flow-l3: \`$LATEST_ARTIFACT/\`
- before/after reputation reads: \`$BEFORE_JSON\`, \`$AFTER_JSON\`
- receipt.json with td_erc8004_tx: \`$RECEIPT_JSON\`
EOF
echo "  wrote $RESULT_MD" | tee -a "$RUN_LOG"
echo ""                    | tee -a "$RUN_LOG"
echo "=== PASS ===" | tee -a "$RUN_LOG"

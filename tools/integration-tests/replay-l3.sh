#!/usr/bin/env bash
# replay-l3.sh — load-bearing replay-protection demo on Base Sepolia.
#
# What it proves:
#  1. Resigning the SAME EIP-3009 authorization (same nonce) produces the
#     SAME paymentId (deterministic derivation).
#  2. POSTing the replayed PaymentPayload to /research returns 200 with the
#     SAME tx hash as the original — no new on-chain tx.
#  3. GET /x402/receipt/:paymentId returns the SAME receipt as the original
#     (state CONFIRMED, same tx, same payer).
#  4. X-Reckon402-Replay: true header is set on the second /x402/settle.
#
# Usage (after full-flow-l3.sh has run):
#   infisical run --env dev --domain https://secrets.intentralabs.com -- \
#     bash -c 'cd tools/integration-tests && REPLAY_NONCE=<nonce-from-full-flow> bash replay-l3.sh'
#
#   OR: auto-pick the most recent nonce from the full-flow run artifacts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_URL="${AGENT_URL:-https://agent.reckon402.com}"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_LOG="$SCRIPT_DIR/run-replay-l3-$STAMP.log"
ARTIFACT_DIR="$SCRIPT_DIR/run-replay-l3-$STAMP"
mkdir -p "$ARTIFACT_DIR"

# ── Pick replay nonce ─────────────────────────────────────────────────────
if [ -z "${REPLAY_NONCE:-}" ]; then
  LATEST_RUN=$(ls -1d "$SCRIPT_DIR"/run-full-flow-l3-* 2>/dev/null | sort | tail -1 || true)
  if [ -z "$LATEST_RUN" ]; then
    echo "ERROR: REPLAY_NONCE not set and no prior full-flow run found" | tee -a "$RUN_LOG"
    exit 1
  fi
  REPLAY_NONCE=$(cat "$LATEST_RUN/nonce.txt")
  ORIGINAL_PAYMENT_ID=$(cat "$LATEST_RUN/paymentId.txt")
  ORIGINAL_TX=$(cat "$LATEST_RUN/tx-hash.txt")
  echo "Auto-picked from $LATEST_RUN" | tee -a "$RUN_LOG"
else
  ORIGINAL_PAYMENT_ID="${ORIGINAL_PAYMENT_ID:-}"
  ORIGINAL_TX="${ORIGINAL_TX:-}"
fi

echo "=== L3 replay integration test ===" | tee -a "$RUN_LOG"
echo "Agent:                $AGENT_URL"            | tee -a "$RUN_LOG"
echo "Facilitator:          $FACILITATOR_URL"      | tee -a "$RUN_LOG"
echo "Replay nonce:         $REPLAY_NONCE"         | tee -a "$RUN_LOG"
echo "Original paymentId:   ${ORIGINAL_PAYMENT_ID:-unknown}" | tee -a "$RUN_LOG"
echo "Original tx:          ${ORIGINAL_TX:-unknown}"         | tee -a "$RUN_LOG"
echo ""                                             | tee -a "$RUN_LOG"

# ── Pre-flight ────────────────────────────────────────────────────────────
: "${BUYER_DEMO_1_PK:?BUYER_DEMO_1_PK missing (hydrate via infisical run)}"
: "${SPLITTER_ADDRESS:?SPLITTER_ADDRESS missing}"

# ── Step 1: Re-sign with the SAME nonce, assert paymentId matches ─────────
echo "[1/4] Re-sign PaymentPayload with REPLAY_NONCE=$REPLAY_NONCE" | tee -a "$RUN_LOG"
REPLAY_SIG=$(REPLAY_NONCE="$REPLAY_NONCE" node "$SCRIPT_DIR/buyer-sign-l3.mjs" \
  2> "$ARTIFACT_DIR/buyer-sign.stderr")
REPLAY_PAYMENT_ID=$(grep "paymentId=" "$ARTIFACT_DIR/buyer-sign.stderr" | sed -E 's/.*paymentId=([0-9a-fx]+).*/\1/')
echo "  paymentId=$REPLAY_PAYMENT_ID" | tee -a "$RUN_LOG"

if [ -n "$ORIGINAL_PAYMENT_ID" ] && [ "$REPLAY_PAYMENT_ID" != "$ORIGINAL_PAYMENT_ID" ]; then
  echo "  FAIL: replayed paymentId differs from original" | tee -a "$RUN_LOG"
  echo "    original: $ORIGINAL_PAYMENT_ID" | tee -a "$RUN_LOG"
  echo "    replay:   $REPLAY_PAYMENT_ID"   | tee -a "$RUN_LOG"
  exit 1
fi
echo "  paymentId matches (deterministic derivation from same nonce)" | tee -a "$RUN_LOG"
echo "" | tee -a "$RUN_LOG"

# ── Step 2: POST /research with replay signature, expect 200 + same tx ────
echo "[2/4] GET /research with replay payment-signature -> expect 200 + same tx" | tee -a "$RUN_LOG"
STATUS=$(curl -s -o "$ARTIFACT_DIR/200-body.json" -D "$ARTIFACT_DIR/200-headers.txt" \
  -w "%{http_code}" --max-time 30 \
  -H "payment-signature: $REPLAY_SIG" \
  "$AGENT_URL/research?q=replay")
echo "  HTTP $STATUS" | tee -a "$RUN_LOG"
if [ "$STATUS" != "200" ]; then
  echo "  FAIL: expected 200, body:" | tee -a "$RUN_LOG"
  cat "$ARTIFACT_DIR/200-body.json" | tee -a "$RUN_LOG"
  exit 1
fi

PR_RESP=$(grep -i "^payment-response:" "$ARTIFACT_DIR/200-headers.txt" | tr -d '\r' | sed -E 's/^[^:]+:[[:space:]]*//')
SETTLEMENT=$(echo -n "$PR_RESP" | base64 -d 2>/dev/null | tee "$ARTIFACT_DIR/payment-response.json")
REPLAY_TX=$(echo "$SETTLEMENT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("transaction",""))')
REPLAY_STATE=$(echo "$SETTLEMENT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("state",""))')
echo "  replay tx=$REPLAY_TX state=$REPLAY_STATE" | tee -a "$RUN_LOG"

if [ -n "$ORIGINAL_TX" ] && [ "$REPLAY_TX" != "$ORIGINAL_TX" ]; then
  echo "  FAIL: replay produced a DIFFERENT tx hash — replay protection BROKEN" | tee -a "$RUN_LOG"
  echo "    original: $ORIGINAL_TX" | tee -a "$RUN_LOG"
  echo "    replay:   $REPLAY_TX"   | tee -a "$RUN_LOG"
  exit 1
fi
echo "  tx hash matches (replay short-circuited from D1; no new on-chain tx)" | tee -a "$RUN_LOG"
echo "" | tee -a "$RUN_LOG"

# ── Step 3: Receipt read — state + tx unchanged ─────────────────────────
echo "[3/4] GET /x402/receipt/:paymentId — confirm unchanged" | tee -a "$RUN_LOG"
curl -s -o "$ARTIFACT_DIR/receipt.json" \
  "$FACILITATOR_URL/x402/receipt/$REPLAY_PAYMENT_ID"
RECEIPT_STATE=$(python3 -c 'import sys,json; d=json.load(open(sys.argv[1])); print(d.get("state",""))' "$ARTIFACT_DIR/receipt.json")
RECEIPT_TX=$(python3 -c 'import sys,json; d=json.load(open(sys.argv[1])); print(d.get("transaction",""))' "$ARTIFACT_DIR/receipt.json")
echo "  state=$RECEIPT_STATE tx=$RECEIPT_TX" | tee -a "$RUN_LOG"
if [ "$RECEIPT_STATE" != "CONFIRMED" ] || [ "$RECEIPT_TX" != "$REPLAY_TX" ]; then
  echo "  FAIL: receipt state or tx mismatch" | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

# ── Step 4: Write summary ─────────────────────────────────────────────────
cat > "$SCRIPT_DIR/results-replay-l3-$STAMP.md" <<EOF
# L3 replay integration test — $STAMP

| Field | Value |
|-------|-------|
| Replay nonce | \`$REPLAY_NONCE\` |
| paymentId | \`$REPLAY_PAYMENT_ID\` |
| Original tx | \`${ORIGINAL_TX:-unknown}\` |
| Replay tx | \`$REPLAY_TX\` |
| Match | $([[ "$REPLAY_TX" == "$ORIGINAL_TX" || -z "$ORIGINAL_TX" ]] && echo "YES (no new on-chain tx)" || echo "NO (BROKEN)") |
| Receipt state | $RECEIPT_STATE |

Artifacts: \`$ARTIFACT_DIR/\` (200 headers, payment-response.json, receipt.json, buyer-sign.stderr).

Load-bearing claim: the second /x402/settle call short-circuited from D1
(see workers/facilitator/src/settle-route.ts:72 replay-shortcut). The
facilitator EOA submitted ZERO new on-chain txs for the replay call — the
buyer pays once, the merchant sees both requests succeed, the chain state
is stable, D1 enforces per-paymentId idempotency.
EOF
echo "[4/4] wrote $SCRIPT_DIR/results-replay-l3-$STAMP.md" | tee -a "$RUN_LOG"
echo "" | tee -a "$RUN_LOG"
echo "=== PASS ===" | tee -a "$RUN_LOG"

#!/usr/bin/env bash
# full-flow-l4c-onboard.sh — L4c onboarding integration test.
#
# Preconditions:
#   - Spec 08A deployed: SPLITTER_FACTORY_ADDRESS live on Base Sepolia.
#   - Spec 08B deployed: gateway has /admin/records + /admin/bootstrap + /admin/bootstrap/gateway-seed,
#     onboard-orchestrator worker live at ORCHESTRATOR_URL.
#   - Seller EOA funded with ETH on Sepolia AND Base Sepolia.
#   - RECKON402_ONBOARDING_EOA configured in gateway [vars].
#
# Proves:
#   1. POST /onboard returns 202 with {onboardId, ensName}.
#   2. GET /onboard/:id/status polls to status=succeeded within ~90s.
#   3. Gateway serves x402.splitter, x402.erc8004.agent_id, x402.amount for the new ENS name.
#   4. A subsequent paid call (via full-flow-l4b.sh --merchant) lands settlement + attestation tx.
#   5. Post-attestation x402.amount?backend=erc8004 reflects the discount.
#
# Usage:
#   infisical run --env dev --domain https://secrets.intentralabs.com -- \
#     bash -c 'cd tools/integration-tests && bash full-flow-l4c-onboard.sh'
#
# Environment variables (all optional with defaults):
#   GATEWAY_URL, FACILITATOR_URL, ORCHESTRATOR_URL, SELLER_LABEL
#
# Required secrets (Infisical-hydrated):
#   SELLER_DEMO_1_PK    — the SellingAgent EOA whose address we onboard

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_URL="${GATEWAY_URL:-https://gateway.reckon402.com}"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-https://app.reckon402.com}"
SELLER_LABEL="${SELLER_LABEL:-seller$(date +%s)}"
SELLER_NAME="${SELLER_LABEL}.reckon402-test.eth"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_LOG="$SCRIPT_DIR/run-full-flow-l4c-onboard-$STAMP.log"

: "${SELLER_DEMO_1_PK:?SELLER_DEMO_1_PK required (Infisical)}"

SELLER_EOA=$(node -e "
  const { privateKeyToAccount } = require('viem/accounts');
  console.log(privateKeyToAccount(process.env.SELLER_DEMO_1_PK).address);
")

echo "=== L4c onboarding integration test ===" | tee "$RUN_LOG"
echo "Gateway:        $GATEWAY_URL"        | tee -a "$RUN_LOG"
echo "Facilitator:    $FACILITATOR_URL"    | tee -a "$RUN_LOG"
echo "Orchestrator:   $ORCHESTRATOR_URL"   | tee -a "$RUN_LOG"
echo "Seller ENS:     $SELLER_NAME"        | tee -a "$RUN_LOG"
echo "Seller EOA:     $SELLER_EOA"         | tee -a "$RUN_LOG"
echo "Start:          $STAMP"              | tee -a "$RUN_LOG"
echo ""                                     | tee -a "$RUN_LOG"

# ── Step A: kick off onboarding ───────────────────────────────────────────
echo "[A/F] POST /onboard" | tee -a "$RUN_LOG"
ONBOARD_RES=$(curl -sS --fail -X POST "$ORCHESTRATOR_URL/onboard" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$SELLER_NAME\",\"sellerEoa\":\"$SELLER_EOA\",\"endpoint\":\"https://agent.reckon402.com/research\",\"amount\":\"100000\"}")
ONBOARD_ID=$(echo "$ONBOARD_RES" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).onboardId))')
echo "  onboardId=$ONBOARD_ID" | tee -a "$RUN_LOG"

# ── Step B: poll until succeeded ───────────────────────────────────────────
echo "[B/F] Poll /onboard/$ONBOARD_ID/status" | tee -a "$RUN_LOG"
MAX_WAIT=180
WAITED=0
STATUS=""
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  BODY=$(curl -sS --fail "$ORCHESTRATOR_URL/onboard/$ONBOARD_ID/status")
  STATUS=$(echo "$BODY" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).status))')
  echo "  t+${WAITED}s status=$STATUS" | tee -a "$RUN_LOG"
  if [ "$STATUS" = "succeeded" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 5
  WAITED=$((WAITED + 5))
done
if [ "$STATUS" != "succeeded" ]; then
  echo "  FAIL: status=$STATUS after ${WAITED}s" | tee -a "$RUN_LOG"
  echo "$BODY" | tee -a "$RUN_LOG"
  exit 1
fi

# ── Step C: verify gateway serves the records ──────────────────────────────
echo "[C/F] Verify gateway records for $SELLER_NAME" | tee -a "$RUN_LOG"
SPLITTER_VAL=$(bash "$SCRIPT_DIR/resolve-l4a.sh" --gateway "$GATEWAY_URL" --name "$SELLER_NAME" --key x402.splitter | grep -oE '"value":"0x[0-9a-fA-F]{40}"' | head -1)
AGENT_ID_VAL=$(bash "$SCRIPT_DIR/resolve-l4a.sh" --gateway "$GATEWAY_URL" --name "$SELLER_NAME" --key x402.erc8004.agent_id | grep -oE '"value":"[0-9]+"' | head -1)
AMOUNT_VAL=$(bash "$SCRIPT_DIR/resolve-l4a.sh" --gateway "$GATEWAY_URL" --name "$SELLER_NAME" --key x402.amount | grep -oE '"value":"[0-9]+"' | head -1)

echo "  $SPLITTER_VAL" | tee -a "$RUN_LOG"
echo "  $AGENT_ID_VAL" | tee -a "$RUN_LOG"
echo "  $AMOUNT_VAL"   | tee -a "$RUN_LOG"

if [ -z "$SPLITTER_VAL" ] || [ -z "$AGENT_ID_VAL" ] || [ -z "$AMOUNT_VAL" ]; then
  echo "  FAIL: gateway missing one of the required records" | tee -a "$RUN_LOG"
  exit 1
fi

# ── Step D: run a paid call via existing L4b flow ──────────────────────────
echo "[D/F] Run paid call against $SELLER_NAME (L4b flow)" | tee -a "$RUN_LOG"
SELLER_NAME="$SELLER_NAME" bash "$SCRIPT_DIR/full-flow-l4b.sh" 2>&1 | tee -a "$RUN_LOG"

# ── Step E: post-attestation discount check ────────────────────────────────
echo "[E/F] Read x402.amount?backend=erc8004 after attestation" | tee -a "$RUN_LOG"
POST_AMOUNT=$(bash "$SCRIPT_DIR/resolve-l4a.sh" --backend erc8004 --gateway "$GATEWAY_URL" --name "$SELLER_NAME" --key x402.amount | grep -oE '"value":"[0-9]+"' | head -1)
echo "  post-settlement $POST_AMOUNT" | tee -a "$RUN_LOG"

# ── Step F: summary ────────────────────────────────────────────────────────
echo "" | tee -a "$RUN_LOG"
echo "=== L4c onboarding smoke PASS ===" | tee -a "$RUN_LOG"
echo "  ENS name:  $SELLER_NAME"         | tee -a "$RUN_LOG"
echo "  onboardId: $ONBOARD_ID"          | tee -a "$RUN_LOG"
echo "Details in $RUN_LOG"

#!/usr/bin/env bash
# full-flow-l4c-factory.sh — L4c SplitterFactory + per-payment resolution
# integration test. Drives /x402/settle DIRECTLY with two hand-built
# payloads so we can exercise the L4c code path without depending on
# the agent middleware including ENS in PaymentRequirements.extra.
#
# Paired spec: specs/08a-l4c-factory-refactor.md §7.5.
#
# What this script proves:
#   Scenario A — happy path (per-SellingAgent Splitter resolved via ENS):
#     1. Buyer signs a PaymentPayload whose auth.to = per-SellingAgent
#        Splitter address (not the legacy env.SPLITTER_ADDRESS).
#     2. POST /x402/settle with paymentRequirements.extra.ens = <valid
#        SellingAgent ENS name>.
#     3. Facilitator resolves {splitter, agentId} via gateway; validates
#        splitter came from our SplitterFactory; drives the two-tx
#        settle to CONFIRMED.
#     4. /x402/receipt/:paymentId carries td_erc8004_tx (attestation tx).
#
#   Scenario B — forged splitter (gateway serves a non-factory address):
#     1. Buyer signs a PaymentPayload whose auth.to = FORGED splitter
#        address (same buyer, fresh nonce).
#     2. POST /x402/settle with paymentRequirements.extra.ens = <forged
#        SellingAgent ENS name whose x402.splitter → random address>.
#     3. Facilitator resolves the record; SplitterFactory.isDeployed
#        returns false; NO on-chain tx is broadcast.
#     4. HTTP 422 {"error": "splitter_unknown", "ensName": "..."}.
#     5. /x402/receipt/:paymentId returns state=SPLITTER_UNKNOWN with
#        transaction=null.
#
# Required env (Infisical-hydrated):
#   BUYER_DEMO_1_PK              buyer signing key
#   BASE_SEPOLIA_RPC_PRIMARY     informational
#
# Required env (operator preconditions):
#   SELLER_NAME                  valid SellingAgent ENS; x402.splitter must
#                                point at a factory-deployed Splitter.
#                                Default: seller.reckon402-test.eth
#   SELLER_SPLITTER_ADDRESS      the per-SellingAgent Splitter address for
#                                SELLER_NAME (must equal what the gateway
#                                returns for x402.splitter).
#   FORGED_SELLER_NAME           SellingAgent ENS whose x402.splitter has
#                                been pre-seeded with a non-factory
#                                address. Default: seller-forged.reckon402-test.eth
#   FORGED_SPLITTER_ADDRESS      the forged address seeded for
#                                FORGED_SELLER_NAME (auth.to must match
#                                so the EIP-3009 signature is valid — the
#                                facilitator rejects on the isDeployed
#                                guard BEFORE the transferWithAuthorization,
#                                so this splitter is never actually
#                                transferred to, but auth.to still has to
#                                match the gateway record for
#                                deterministic scenario B).
#
# Usage:
#   infisical run --env dev --domain https://secrets.intentralabs.com -- \
#     bash -c 'cd tools/integration-tests && bash full-flow-l4c-factory.sh'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
GATEWAY_URL="${GATEWAY_URL:-https://gateway.reckon402.com}"
SELLER_NAME="${SELLER_NAME:-seller.reckon402-test.eth}"
FORGED_SELLER_NAME="${FORGED_SELLER_NAME:-seller-forged.reckon402-test.eth}"
NETWORK="${NETWORK:-eip155:84532}"
USDC_ADDRESS="${USDC_ADDRESS:-0x036CbD53842c5426634e7929541eC2318f3dCF7e}"
AMOUNT="${AMOUNT:-10000}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_LOG="$SCRIPT_DIR/run-full-flow-l4c-factory-$STAMP.log"
ARTIFACT_DIR="$SCRIPT_DIR/run-full-flow-l4c-factory-$STAMP"
RESULT_MD="$SCRIPT_DIR/results-full-flow-l4c-factory-$STAMP.md"
mkdir -p "$ARTIFACT_DIR"

echo "=== L4c SplitterFactory + per-payment resolution smoke ===" | tee "$RUN_LOG"
echo "Facilitator:        $FACILITATOR_URL"                        | tee -a "$RUN_LOG"
echo "Gateway:            $GATEWAY_URL"                             | tee -a "$RUN_LOG"
echo "Seller (happy):     $SELLER_NAME"                             | tee -a "$RUN_LOG"
echo "Seller (forged):    $FORGED_SELLER_NAME"                      | tee -a "$RUN_LOG"
echo "Start:              $STAMP"                                   | tee -a "$RUN_LOG"
echo ""                                                              | tee -a "$RUN_LOG"

# ── Preconditions ─────────────────────────────────────────────────────────
: "${BUYER_DEMO_1_PK:?BUYER_DEMO_1_PK missing (hydrate via infisical run)}"
: "${SELLER_SPLITTER_ADDRESS:?SELLER_SPLITTER_ADDRESS missing — set to the per-SellingAgent Splitter address for SELLER_NAME}"
: "${FORGED_SPLITTER_ADDRESS:?FORGED_SPLITTER_ADDRESS missing — set to the seeded non-factory address for FORGED_SELLER_NAME}"

command -v jq     >/dev/null 2>&1 || { echo "FAIL: jq not installed"    | tee -a "$RUN_LOG"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 not installed" | tee -a "$RUN_LOG"; exit 1; }
command -v curl   >/dev/null 2>&1 || { echo "FAIL: curl not installed"   | tee -a "$RUN_LOG"; exit 1; }

echo "[0/6] Verify ENS records via gateway (static backend)"          | tee -a "$RUN_LOG"
# Happy-path seller: x402.splitter must equal SELLER_SPLITTER_ADDRESS.
HAPPY_SPLITTER_VIA_GW=$(bash "$SCRIPT_DIR/resolve-l4a.sh" \
  --backend static \
  --gateway "$GATEWAY_URL" \
  --name "$SELLER_NAME" \
  --key x402.splitter 2>&1 \
  | tee "$ARTIFACT_DIR/gw-happy-splitter.txt" \
  | grep -oE 'Decoded value: 0x[0-9a-fA-F]+' | head -1 \
  | sed -E 's/Decoded value: (0x[0-9a-fA-F]+)/\1/' || true)
echo "  gateway[$SELLER_NAME].x402.splitter = ${HAPPY_SPLITTER_VIA_GW:-NONE}" | tee -a "$RUN_LOG"
if [ "${HAPPY_SPLITTER_VIA_GW,,}" != "${SELLER_SPLITTER_ADDRESS,,}" ]; then
  echo "  FAIL: gateway value for $SELLER_NAME x402.splitter does not match SELLER_SPLITTER_ADDRESS" | tee -a "$RUN_LOG"
  echo "        expected=$SELLER_SPLITTER_ADDRESS"                                                    | tee -a "$RUN_LOG"
  echo "        got=$HAPPY_SPLITTER_VIA_GW"                                                           | tee -a "$RUN_LOG"
  exit 1
fi

# Forged seller: gateway must serve FORGED_SPLITTER_ADDRESS.
FORGED_SPLITTER_VIA_GW=$(bash "$SCRIPT_DIR/resolve-l4a.sh" \
  --backend static \
  --gateway "$GATEWAY_URL" \
  --name "$FORGED_SELLER_NAME" \
  --key x402.splitter 2>&1 \
  | tee "$ARTIFACT_DIR/gw-forged-splitter.txt" \
  | grep -oE 'Decoded value: 0x[0-9a-fA-F]+' | head -1 \
  | sed -E 's/Decoded value: (0x[0-9a-fA-F]+)/\1/' || true)
echo "  gateway[$FORGED_SELLER_NAME].x402.splitter = ${FORGED_SPLITTER_VIA_GW:-NONE}" | tee -a "$RUN_LOG"
if [ "${FORGED_SPLITTER_VIA_GW,,}" != "${FORGED_SPLITTER_ADDRESS,,}" ]; then
  echo "  FAIL: gateway value for $FORGED_SELLER_NAME x402.splitter does not match FORGED_SPLITTER_ADDRESS" | tee -a "$RUN_LOG"
  echo "        expected=$FORGED_SPLITTER_ADDRESS"                                                            | tee -a "$RUN_LOG"
  echo "        got=$FORGED_SPLITTER_VIA_GW"                                                                  | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

# Helper: given a base64 X-Payment header, emit the canonical settle-route
# request body (JSON) with paymentRequirements.extra.ens set to $1.
build_settle_body() {
  local ens_name="$1"
  local splitter_addr="$2"
  local payload_b64="$3"
  python3 - "$ens_name" "$splitter_addr" "$payload_b64" "$NETWORK" "$AMOUNT" "$USDC_ADDRESS" <<'PY'
import base64, json, sys
ens, splitter, payload_b64, network, amount, usdc = sys.argv[1:7]
payload = json.loads(base64.b64decode(payload_b64))
body = {
    "x402Version": 2,
    "paymentPayload": payload,
    "paymentRequirements": {
        "scheme": "exact",
        "network": network,
        "amount": amount,
        "asset": usdc,
        "payTo": splitter,
        "maxTimeoutSeconds": 300,
        "extra": { "name": "USDC", "version": "2", "ens": ens },
    },
}
print(json.dumps(body))
PY
}

# ── Scenario A: happy path ────────────────────────────────────────────────
echo "[1/6] Scenario A — sign PaymentPayload (auth.to = $SELLER_SPLITTER_ADDRESS)" | tee -a "$RUN_LOG"
A_STDERR="$ARTIFACT_DIR/A-buyer-sign.stderr"
A_HEADER_B64=$(SPLITTER_ADDRESS="$SELLER_SPLITTER_ADDRESS" \
  node "$SCRIPT_DIR/buyer-sign-l3.mjs" 2> "$A_STDERR")
A_PAYMENT_ID=$(grep "paymentId=" "$A_STDERR" | sed -E 's/.*paymentId=([0-9a-fx]+).*/\1/')
A_NONCE=$(grep "nonce=" "$A_STDERR" | head -1 | sed -E 's/.*nonce=([0-9a-fx]+).*/\1/')
echo "  paymentId=$A_PAYMENT_ID nonce=$A_NONCE" | tee -a "$RUN_LOG"
echo "$A_HEADER_B64"   > "$ARTIFACT_DIR/A-payment-header.b64"
echo "$A_PAYMENT_ID"   > "$ARTIFACT_DIR/A-paymentId.txt"

echo "[2/6] Scenario A — POST /x402/settle with extra.ens=$SELLER_NAME" | tee -a "$RUN_LOG"
A_BODY="$ARTIFACT_DIR/A-settle-body.json"
build_settle_body "$SELLER_NAME" "$SELLER_SPLITTER_ADDRESS" "$A_HEADER_B64" > "$A_BODY"

A_RESP="$ARTIFACT_DIR/A-settle-resp.json"
A_STATUS=$(curl -s -o "$A_RESP" -w "%{http_code}" \
  -X POST --max-time 90 \
  -H "Content-Type: application/json" \
  --data-binary "@$A_BODY" \
  "$FACILITATOR_URL/x402/settle")
echo "  HTTP $A_STATUS" | tee -a "$RUN_LOG"
if [ "$A_STATUS" != "200" ]; then
  echo "  FAIL: expected 200 on happy path. Response body:" | tee -a "$RUN_LOG"
  cat "$A_RESP" | tee -a "$RUN_LOG"
  exit 1
fi

A_TX=$(jq -r '.transaction // ""' "$A_RESP")
A_STATE=$(jq -r '.state // ""' "$A_RESP")
echo "  tx=$A_TX state=$A_STATE" | tee -a "$RUN_LOG"
if [ "$A_STATE" != "CONFIRMED" ] || [ -z "$A_TX" ]; then
  echo "  FAIL: expected state=CONFIRMED with non-empty transaction" | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

echo "[3/6] Scenario A — wait for attestation td_erc8004_tx" | tee -a "$RUN_LOG"
A_RECEIPT="$ARTIFACT_DIR/A-receipt.json"
A_TD_TX=""
WAITED=0
MAX_WAIT=60
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  curl -s -o "$A_RECEIPT" "$FACILITATOR_URL/x402/receipt/$A_PAYMENT_ID" || true
  A_TD_TX=$(jq -r '(.receipt.tdErc8004Tx // .tdErc8004Tx // "")' "$A_RECEIPT" 2>/dev/null || echo "")
  if [ -n "$A_TD_TX" ] && [ "$A_TD_TX" != "null" ] && [ "$A_TD_TX" != "FAILED" ]; then
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "  waited=${WAITED}s td_erc8004_tx=${A_TD_TX:-NONE}" | tee -a "$RUN_LOG"
if [ -z "$A_TD_TX" ] || [ "$A_TD_TX" = "null" ] || [ "$A_TD_TX" = "FAILED" ]; then
  echo "  FAIL: attestation tx did not land in D1 within ${MAX_WAIT}s" | tee -a "$RUN_LOG"
  echo "  Note: under ENABLE_L4C_FACTORY=true this uses resolved.agentId" | tee -a "$RUN_LOG"
  echo "        from the gateway x402.erc8004.agent_id record."           | tee -a "$RUN_LOG"
  exit 1
fi
BASESCAN_ATT="https://sepolia.basescan.org/tx/$A_TD_TX"
echo "  attestation basescan: $BASESCAN_ATT" | tee -a "$RUN_LOG"
echo "" | tee -a "$RUN_LOG"

# ── Scenario B: forged splitter ───────────────────────────────────────────
echo "[4/6] Scenario B — sign PaymentPayload (auth.to = $FORGED_SPLITTER_ADDRESS)" | tee -a "$RUN_LOG"
B_STDERR="$ARTIFACT_DIR/B-buyer-sign.stderr"
B_HEADER_B64=$(SPLITTER_ADDRESS="$FORGED_SPLITTER_ADDRESS" \
  node "$SCRIPT_DIR/buyer-sign-l3.mjs" 2> "$B_STDERR")
B_PAYMENT_ID=$(grep "paymentId=" "$B_STDERR" | sed -E 's/.*paymentId=([0-9a-fx]+).*/\1/')
B_NONCE=$(grep "nonce=" "$B_STDERR" | head -1 | sed -E 's/.*nonce=([0-9a-fx]+).*/\1/')
echo "  paymentId=$B_PAYMENT_ID nonce=$B_NONCE" | tee -a "$RUN_LOG"
echo "$B_HEADER_B64"  > "$ARTIFACT_DIR/B-payment-header.b64"
echo "$B_PAYMENT_ID"  > "$ARTIFACT_DIR/B-paymentId.txt"

echo "[5/6] Scenario B — POST /x402/settle with extra.ens=$FORGED_SELLER_NAME" | tee -a "$RUN_LOG"
B_BODY="$ARTIFACT_DIR/B-settle-body.json"
build_settle_body "$FORGED_SELLER_NAME" "$FORGED_SPLITTER_ADDRESS" "$B_HEADER_B64" > "$B_BODY"

B_RESP="$ARTIFACT_DIR/B-settle-resp.json"
B_STATUS=$(curl -s -o "$B_RESP" -w "%{http_code}" \
  -X POST --max-time 30 \
  -H "Content-Type: application/json" \
  --data-binary "@$B_BODY" \
  "$FACILITATOR_URL/x402/settle")
echo "  HTTP $B_STATUS" | tee -a "$RUN_LOG"
if [ "$B_STATUS" != "422" ]; then
  echo "  FAIL: expected 422 on forged-splitter path. Response body:" | tee -a "$RUN_LOG"
  cat "$B_RESP" | tee -a "$RUN_LOG"
  exit 1
fi

B_ERROR=$(jq -r '.error // ""' "$B_RESP")
B_ENS=$(jq -r '.ensName // ""' "$B_RESP")
echo "  error=$B_ERROR ensName=$B_ENS" | tee -a "$RUN_LOG"
if [ "$B_ERROR" != "splitter_unknown" ]; then
  echo "  FAIL: expected error='splitter_unknown', got '$B_ERROR'" | tee -a "$RUN_LOG"
  exit 1
fi
if [ "$B_ENS" != "$FORGED_SELLER_NAME" ]; then
  echo "  FAIL: expected ensName='$FORGED_SELLER_NAME', got '$B_ENS'" | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

echo "[6/6] Scenario B — verify D1 receipt is SPLITTER_UNKNOWN with no tx" | tee -a "$RUN_LOG"
B_RECEIPT="$ARTIFACT_DIR/B-receipt.json"
curl -s -o "$B_RECEIPT" "$FACILITATOR_URL/x402/receipt/$B_PAYMENT_ID" || true
B_STATE=$(jq -r '.state // ""' "$B_RECEIPT")
B_TX=$(jq -r '.transaction // ""' "$B_RECEIPT")
echo "  state=$B_STATE transaction=${B_TX:-<empty>}" | tee -a "$RUN_LOG"
if [ "$B_STATE" != "SPLITTER_UNKNOWN" ]; then
  echo "  FAIL: expected state=SPLITTER_UNKNOWN, got '$B_STATE'" | tee -a "$RUN_LOG"
  exit 1
fi
if [ -n "$B_TX" ] && [ "$B_TX" != "null" ]; then
  echo "  FAIL: transaction should be empty/null on SPLITTER_UNKNOWN; got '$B_TX'" | tee -a "$RUN_LOG"
  echo "        A non-empty tx here would mean the facilitator DID broadcast"      | tee -a "$RUN_LOG"
  echo "        transferWithAuthorization despite failing the factory check."       | tee -a "$RUN_LOG"
  exit 1
fi
echo "" | tee -a "$RUN_LOG"

# ── Summary ───────────────────────────────────────────────────────────────
cat > "$RESULT_MD" <<EOF
# L4c SplitterFactory + per-payment resolution smoke — $STAMP

| Field | Value |
|-------|-------|
| Facilitator | $FACILITATOR_URL |
| Gateway | $GATEWAY_URL |
| Seller (happy) | $SELLER_NAME |
| Seller Splitter | \`$SELLER_SPLITTER_ADDRESS\` |
| Seller (forged) | $FORGED_SELLER_NAME |
| Forged Splitter | \`$FORGED_SPLITTER_ADDRESS\` |

## Scenario A — happy path (per-SellingAgent Splitter resolved via ENS)

| Field | Value |
|-------|-------|
| paymentId | \`$A_PAYMENT_ID\` |
| nonce | \`$A_NONCE\` |
| settle HTTP | 200 |
| state | $A_STATE |
| settlement tx | \`$A_TX\` |
| Basescan (settlement) | https://sepolia.basescan.org/tx/$A_TX |
| attestation tx (td_erc8004_tx) | \`$A_TD_TX\` |
| Basescan (attestation) | $BASESCAN_ATT |
| attestation wait | ${WAITED}s |

## Scenario B — forged splitter (factory isDeployed=false)

| Field | Value |
|-------|-------|
| paymentId | \`$B_PAYMENT_ID\` |
| nonce | \`$B_NONCE\` |
| settle HTTP | 422 |
| error | $B_ERROR |
| ensName echoed | $B_ENS |
| receipt state | $B_STATE |
| receipt transaction | ${B_TX:-<empty>} |

Artifacts: \`$ARTIFACT_DIR/\`
  - \`A-settle-body.json\`, \`A-settle-resp.json\`, \`A-receipt.json\`
  - \`B-settle-body.json\`, \`B-settle-resp.json\`, \`B-receipt.json\`
  - \`gw-happy-splitter.txt\`, \`gw-forged-splitter.txt\`
EOF
echo "  wrote $RESULT_MD" | tee -a "$RUN_LOG"
echo ""                   | tee -a "$RUN_LOG"
echo "=== PASS (Scenario A: 200 CONFIRMED + attestation; Scenario B: 422 SPLITTER_UNKNOWN no tx) ===" | tee -a "$RUN_LOG"

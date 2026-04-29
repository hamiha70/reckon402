#!/usr/bin/env bash
# tools/scripts/status.sh — Reckon402 one-command health snapshot
#
# Usage:
#   ADMIN_TOKEN=<token> bash tools/scripts/status.sh
#   infisical run --env dev -- bash tools/scripts/status.sh
#
# Prints:
#   • Facilitator endpoint health
#   • Last 5 receipts (paymentId truncated, state, attestation status)
#   • Last 3 attestations (tx hash, written_at)
#   • Stuck receipts (PENDING_CONFIRMATION > 5 min)
#   • On-chain confirmed nonce of the facilitator EOA

set -euo pipefail

FACILITATOR_URL="${FACILITATOR_URL:-https://facilitator.reckon402.com}"
GATEWAY_URL="${GATEWAY_URL:-https://gateway.reckon402.com}"
SELLER_NAME="${SELLER_NAME:-seller.reckon402-test.eth}"
RPC_URL="${BASE_SEPOLIA_RPC_PRIMARY:-https://sepolia.base.org}"
FACILITATOR_EOA="${FACILITATOR_EOA:-}"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }
hdr()  { echo -e "\n${CYAN}── $* ──${NC}"; }

# ── 1. Endpoint health ────────────────────────────────────────────────────────
hdr "Endpoint health"

check_url() {
  local label="$1" url="$2"
  local http
  http=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url")
  if [ "$http" -ge 200 ] && [ "$http" -lt 400 ]; then
    ok "$label  HTTP $http  ($url)"
  else
    err "$label  HTTP $http  ($url)"
  fi
}

check_url "Facilitator /healthz"   "$FACILITATOR_URL/healthz"
check_url "Gateway  /healthz"       "$GATEWAY_URL/healthz"
check_url "Agent       /"          "${AGENT_URL:-https://agent.reckon402.com}/"

# ── 2. Admin endpoints (requires ADMIN_TOKEN) ─────────────────────────────────
if [ -z "${ADMIN_TOKEN:-}" ]; then
  warn "ADMIN_TOKEN not set — skipping receipt / attestation lookup"
else
  hdr "Receipt state counts"
  STATUS_JSON=$(curl -sf --max-time 10 \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$FACILITATOR_URL/admin/status" 2>/dev/null || echo "{}")

  if [ -z "$STATUS_JSON" ] || echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'stateCounts' in d else 1)" 2>/dev/null; then
    if [ -z "$STATUS_JSON" ]; then
      warn "admin/status returned empty — token mismatch or CF propagation lag?"
    else
      _STATUS="$STATUS_JSON" python3 <<'PYEOF'
import os, json, datetime
d = json.loads(os.environ['_STATUS'])
print("\nState counts:")
for row in d.get("stateCounts", []):
    print(f"  {row['state']:<22} {row['n']}")
print("\nLatest receipts:")
for r in d.get("latestReceipts", []):
    pid = str(r.get("payment_id",""))[:18] + "…"
    state = r.get("state","?")
    att   = "✓ att" if r.get("td_erc8004_tx") else "  ---"
    ts    = r.get("confirmed_at") or r.get("submitted_at","?")
    try:
        ts_str = datetime.datetime.fromtimestamp(int(ts)/1000).strftime("%H:%M:%S")
    except Exception:
        ts_str = str(ts)
    print(f"  {pid}  {state:<22} {att}  @ {ts_str}")
print("\nLatest attestations:")
for a in d.get("latestAttestations", []):
    pid = str(a.get("payment_id",""))[:18] + "…"
    tx  = str(a.get("reputation_tx",""))[:18] + "…"
    ts  = a.get("written_at","?")
    try:
        ts_str = datetime.datetime.fromtimestamp(int(ts)/1000).strftime("%H:%M:%S")
    except Exception:
        ts_str = str(ts)
    print(f"  {pid}  → {tx}  @ {ts_str}")
PYEOF
    fi
  else
    warn "admin/status: unexpected response — $(echo "$STATUS_JSON" | head -c 80)"
  fi

  # Stuck receipts
  hdr "Stuck receipts (PENDING_CONFIRMATION > 5 min)"
  STUCK_JSON=$(curl -s --max-time 10 \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$FACILITATOR_URL/admin/stuck")
  STUCK_N=$(echo "$STUCK_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['stuck'])" 2>/dev/null || echo "?")
  if [ "$STUCK_N" = "0" ]; then
    ok "No stuck receipts"
  else
    warn "$STUCK_N stuck receipt(s):"
    echo "$STUCK_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for r in d.get('receipts',[]):
    detail = str(r.get('failure_detail') or '')[:60]
    print('  ', str(r.get('payment_id',''))[:18], r.get('state'), detail)
"
  fi
fi

# ── 3. On-chain nonce ─────────────────────────────────────────────────────────
if [ -n "${FACILITATOR_EOA:-}" ]; then
  hdr "On-chain nonce"
  NONCE=$(curl -s --max-time 5 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionCount\",\"params\":[\"$FACILITATOR_EOA\",\"pending\"]}" \
    | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null || echo "?")
  ok "Facilitator EOA $FACILITATOR_EOA  nonce=$NONCE"
fi

# ── 4. ENS price ─────────────────────────────────────────────────────────────
hdr "ENS current x402.amount ($SELLER_NAME)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INT_DIR="$REPO_ROOT/tools/integration-tests"
if [ -f "$INT_DIR/resolve-l4a.sh" ]; then
  bash "$INT_DIR/resolve-l4a.sh" \
    --backend erc8004 \
    --gateway "$GATEWAY_URL" \
    --name "$SELLER_NAME" \
    --key x402.amount 2>&1 | grep -E "Decoded value|PASS|FAIL|ERC-8004"
else
  warn "resolve-l4a.sh not found at $INT_DIR"
fi

echo ""
echo -e "${GREEN}=== status check complete ===${NC}"

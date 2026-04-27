#!/usr/bin/env bash
# Integration test: agent.reckon402.com (L1)
# Curls all live routes and asserts expected status + body content.
# Exits 0 (PASS) only if all assertions hold.
# Usage: bash tools/integration-tests/agent.sh
#
# Mirrors the tools/smoke-tests/*.sh pattern — uses the same common.sh
# helpers when available, falls back to plain echo.

set -euo pipefail

BASE_URL="https://agent.reckon402.com"
PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL $1" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# assert_http <label> <url> <expected_status> [expected_body_substr]
assert_http() {
  local label="$1" url="$2" expected_status="$3" expected_substr="${4:-}"
  local http_status body

  body=$(curl -s -w '\n__STATUS__%{http_code}' "$url") || {
    fail "$label — curl error"
    return
  }

  http_status=$(printf '%s' "$body" | grep -o '__STATUS__[0-9]*' | sed 's/__STATUS__//')
  body=$(printf '%s' "$body" | sed 's/__STATUS__[0-9]*$//')

  if [[ "$http_status" != "$expected_status" ]]; then
    fail "$label — expected HTTP $expected_status, got $http_status"
    return
  fi

  if [[ -n "$expected_substr" && "$body" != *"$expected_substr"* ]]; then
    fail "$label — body missing \"$expected_substr\" (got: $body)"
    return
  fi

  pass "$label"
}

echo "=== agent.reckon402.com integration test (L1) ==="
echo "Target: $BASE_URL"
echo ""

assert_http "GET /health → 200 + ok"              "$BASE_URL/health"              "200" '"ok"'
assert_http "GET /research?q= → 200 + agent name"  "$BASE_URL/research?q=l1-test" "200" "reckon402-demo-research"
assert_http "GET /research (no q) → 400"           "$BASE_URL/research"            "400" '"q is required"'
assert_http "GET / → 200"                          "$BASE_URL/"                    "200" ""

echo ""
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "FAIL agent.reckon402.com integration test"
  exit 1
fi

echo "PASS agent.reckon402.com integration test"
exit 0

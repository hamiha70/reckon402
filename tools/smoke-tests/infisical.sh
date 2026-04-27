#!/usr/bin/env bash
# Probe 1 — Infisical hydration layer.
# See specs/00-l0-smoke-tests.md §1.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start infisical
require curl
require jq
require infisical

DOMAIN="${INFISICAL_DOMAIN:-https://secrets.intentralabs.com}"
PROJECT="${INFISICAL_PROJECT_ID:-84d8a29b-27e3-46d0-bf72-bbe01215ac35}"
ENV="${INFISICAL_ENV:-dev}"

# 1. Host /api/status reachable.
status_body="$(curl -fsS --max-time 5 "$DOMAIN/api/status" 2>&1)" \
  || probe_fail "status endpoint unreachable: $status_body"

echo "$status_body" | jq -e '.date' >/dev/null 2>&1 \
  || probe_fail "status response missing .date field: $status_body"

# 2. CLI session valid.
token="$(infisical user get token --plain --silent 2>/dev/null || true)"
[[ -n "$token" ]] \
  || probe_fail "no valid CLI session — run: infisical login --domain $DOMAIN"

# 3. Round-trip a sentinel secret.
sentinel_value="l0-$(date +%s)"
sentinel_key="_L0_SENTINEL"

if ! infisical secrets set "${sentinel_key}=${sentinel_value}" \
       --projectId "$PROJECT" --env "$ENV" --domain "$DOMAIN" \
       >/dev/null 2>&1; then
  probe_fail "sentinel set failed"
fi

readback="$(infisical secrets get "$sentinel_key" \
  --projectId "$PROJECT" --env "$ENV" --domain "$DOMAIN" \
  --plain --silent 2>/dev/null | tr -d '\n')"

# Always attempt to clean up the sentinel, even on assertion failure.
infisical secrets delete "$sentinel_key" \
  --projectId "$PROJECT" --env "$ENV" --domain "$DOMAIN" \
  >/dev/null 2>&1 || true

[[ "$readback" == "$sentinel_value" ]] \
  || probe_fail "sentinel round-trip mismatch: expected '$sentinel_value', got '$readback'"

probe_pass "host=${DOMAIN##https://} project=${PROJECT:0:8}..."

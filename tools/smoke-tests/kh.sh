#!/usr/bin/env bash
# Probe 7 — KeeperHub CLI + auth + API reachability smoke.
# See specs/00-l0-smoke-tests.md §7.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start kh
require kh
require jq

# 1. Auth status — pin to JSON so we don't depend on the human-table
#    column layout. Empty / non-zero exit => not authenticated.
auth_json="$(kh auth status --json 2>/dev/null || true)"
if [[ -z "$auth_json" ]]; then
  probe_skip "kh CLI on PATH but not authenticated; run 'kh auth login' or set KH_API_KEY"
fi

method="$(printf '%s' "$auth_json" | jq -r '.method // empty')"
email="$(printf '%s' "$auth_json"  | jq -r '.email // empty')"
org_id="$(printf '%s' "$auth_json" | jq -r '.organization_id // empty')"

case "$method" in
  token|apikey) : ;;
  *) probe_fail "kh auth status: unexpected method='${method:-empty}' (expected token or apikey)" ;;
esac

[[ -n "$email"  ]] || probe_fail "kh auth status: empty email"
[[ -n "$org_id" ]] || probe_fail "kh auth status: empty organization_id"

# 2. Doctor — JSON array of {name, status, message}.
doctor_json="$(kh doctor --json 2>/dev/null || true)"
if [[ -z "$doctor_json" ]]; then
  probe_fail "kh doctor returned no JSON"
fi

# Required entries must all be 'pass'. Wallet may be 'warn' (creator-wallet
# REST needs extra auth not in scope at L0). Any other 'fail'/'warn' is a
# regression and trips the probe.
required=(CLI\ Version Auth API Chains)
for name in "${required[@]}"; do
  status="$(printf '%s' "$doctor_json" \
    | jq -r --arg n "$name" '.[] | select(.name == $n) | .status')"
  if [[ -z "$status" ]]; then
    probe_fail "kh doctor: missing required entry '$name'"
  fi
  if [[ "$status" != "pass" ]]; then
    msg="$(printf '%s' "$doctor_json" \
      | jq -r --arg n "$name" '.[] | select(.name == $n) | .message')"
    probe_fail "kh doctor: '$name' = '$status' ($msg)"
  fi
done

# Surface anything else that isn't pass/warn.
non_pass="$(printf '%s' "$doctor_json" \
  | jq -r '.[] | select(.status != "pass" and .status != "warn") | "\(.name)=\(.status)"' \
  | tr '\n' ',' | sed 's/,$//')"
if [[ -n "$non_pass" ]]; then
  probe_fail "kh doctor: unexpected non-pass entries: $non_pass"
fi

# Capture chains count + version for the summary line.
chains_msg="$(printf '%s' "$doctor_json" \
  | jq -r '.[] | select(.name == "Chains") | .message')"
chains="$(printf '%s' "$chains_msg" | grep -oE '^[0-9]+' || true)"
ver_msg="$(printf '%s' "$doctor_json" \
  | jq -r '.[] | select(.name == "CLI Version") | .message')"

probe_pass "user=$email org=$org_id chains=${chains:-?} cli=${ver_msg:-?} auth=$method"

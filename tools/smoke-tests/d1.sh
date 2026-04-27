#!/usr/bin/env bash
# Probe 8 — Cloudflare D1 INSERT/SELECT round-trip.
# See specs/00-l0-smoke-tests.md §8.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start d1
require jq
WRANGLER="$(wrangler_bin)"

DB_NAME="reckon402-d1-smoke-test"

# 1. Create database (idempotent — tolerate "already exists").
create_out="$("$WRANGLER" d1 create "$DB_NAME" 2>&1 || true)"
if echo "$create_out" | grep -qiE 'already exists|database with that name already'; then
  : # OK — pre-existing, continue.
elif echo "$create_out" | grep -qiE 'created|database_id'; then
  : # OK — fresh create.
else
  probe_fail "wrangler d1 create unexpected: $create_out"
fi

# 2. Schema (idempotent).
exec_q() {
  "$WRANGLER" d1 execute "$DB_NAME" --remote --command "$1" --json 2>&1
}

schema_out="$(exec_q "CREATE TABLE IF NOT EXISTS l0 (k TEXT PRIMARY KEY, v TEXT, ts INTEGER)")"
echo "$schema_out" | grep -qE '"success": ?true' \
  || probe_fail "CREATE TABLE failed: $schema_out"

# 3. INSERT + SELECT round-trip with timing.
sentinel="$(date +%s)"
key="_l0_${sentinel}"
ins_t0="$(now_ms)"
ins_out="$(exec_q "INSERT INTO l0 (k, v, ts) VALUES ('$key', '$sentinel', $sentinel)")"
echo "$ins_out" | grep -qE '"success": ?true' \
  || probe_fail "INSERT failed: $ins_out"

sel_out="$(exec_q "SELECT v FROM l0 WHERE k = '$key'")"
roundtrip_ms=$(( $(now_ms) - ins_t0 ))

got="$(echo "$sel_out" | jq -r '.[0].results[0].v // empty' 2>/dev/null)"
[[ "$got" == "$sentinel" ]] \
  || probe_fail "SELECT mismatch: expected $sentinel got '$got' raw=$sel_out"

# 4. Cleanup row (best-effort).
exec_q "DELETE FROM l0 WHERE k = '$key'" >/dev/null 2>&1 || true

# Latency gate.
if (( roundtrip_ms > 50 )); then
  probe_fail "INSERT+SELECT latency ${roundtrip_ms}ms exceeds 50ms"
fi

probe_pass "db=$DB_NAME roundtrip=${roundtrip_ms}ms"

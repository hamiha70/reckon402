#!/usr/bin/env bash
# Shared helpers for L0 smoke-test probes. Source this from each probe.
#
#   source "$(dirname "$0")/lib/common.sh"
#
# Provides:
#   probe_start <name>          init timer + name
#   probe_pass [note]           emit "PASS <name> <ms> [note]" + exit 0
#   probe_skip <reason>         emit "SKIP <name> <ms> <reason>" + exit 2
#   probe_fail <reason>         emit "FAIL <name> <ms> <reason>" to stderr + exit 1
#   hydrate <KEY>               echo Infisical secret value to stdout (or empty)
#   require <cmd>               die if <cmd> not on PATH
#   now_ms                      print current epoch milliseconds

set -euo pipefail

PROBE_NAME=""
PROBE_T0_MS=0

now_ms() {
  printf '%s\n' "$(($(date +%s%N) / 1000000))"
}

probe_start() {
  PROBE_NAME="$1"
  PROBE_T0_MS=$(now_ms)
}

_probe_elapsed_ms() {
  printf '%s\n' "$(( $(now_ms) - PROBE_T0_MS ))"
}

probe_pass() {
  local note="${1:-}"
  if [[ -n "$note" ]]; then
    printf 'PASS %s %dms %s\n' "$PROBE_NAME" "$(_probe_elapsed_ms)" "$note"
  else
    printf 'PASS %s %dms\n' "$PROBE_NAME" "$(_probe_elapsed_ms)"
  fi
  exit 0
}

probe_skip() {
  local reason="${1:-skipped}"
  printf 'SKIP %s %dms %s\n' "$PROBE_NAME" "$(_probe_elapsed_ms)" "$reason"
  exit 2
}

probe_fail() {
  local reason="${1:-failed}"
  printf 'FAIL %s %dms %s\n' "$PROBE_NAME" "$(_probe_elapsed_ms)" "$reason" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null 2>&1 || probe_fail "missing dependency: $1"
}

# hydrate <KEY>
# Echoes the secret value from Infisical (reckon402/dev) to stdout.
# Empty string on failure (caller must check).
hydrate() {
  local key="$1"
  local domain="${INFISICAL_DOMAIN:-https://secrets.intentralabs.com}"
  local project="${INFISICAL_PROJECT_ID:-84d8a29b-27e3-46d0-bf72-bbe01215ac35}"
  local env="${INFISICAL_ENV:-dev}"
  infisical secrets get "$key" \
    --projectId "$project" \
    --env "$env" \
    --domain "$domain" \
    --plain --silent 2>/dev/null | tr -d '\n' || true
}

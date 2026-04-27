#!/usr/bin/env bash
# Probe 2 — Cloudflare CLI auth + DNS + dry-run.
# See specs/00-l0-smoke-tests.md §2.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start cf
require dig
WRANGLER="$(wrangler_bin)"

# 1. wrangler whoami succeeds.
whoami_out="$("$WRANGLER" whoami 2>&1)" \
  || probe_fail "wrangler whoami failed: $whoami_out"

# Account ID surfaced on its own line in modern wrangler.
account_id="$(echo "$whoami_out" \
  | grep -oE '[0-9a-f]{32}' | head -n1 || true)"

# 2. Root domain resolves.
root_a="$(dig +short reckon402.com @1.1.1.1 | grep -E '^[0-9.]+$' | head -n1 || true)"
[[ -n "$root_a" ]] || probe_fail "reckon402.com does not resolve via 1.1.1.1"

# 3. Subdomain DNS — soft check, not failure.
warnings=()
for sub in agent facilitator gateway signing demo; do
  if [[ -z "$(dig +short "${sub}.reckon402.com" @1.1.1.1 | head -n1)" ]]; then
    warnings+=("${sub}.reckon402.com missing")
  fi
done

# 4. Wrangler dry-run.
PLACEHOLDER_DIR="$DIR/cf-placeholder"
[[ -d "$PLACEHOLDER_DIR" ]] || probe_fail "missing $PLACEHOLDER_DIR"

dry_run_out="$("$WRANGLER" deploy --dry-run --config "$PLACEHOLDER_DIR/wrangler.toml" 2>&1)" \
  || probe_fail "wrangler dry-run failed: $dry_run_out"

note="account=${account_id:-unknown} root=${root_a}"
if (( ${#warnings[@]} > 0 )); then
  note="$note subdomains-missing=$(IFS=,; echo "${warnings[*]}")"
fi

probe_pass "$note"

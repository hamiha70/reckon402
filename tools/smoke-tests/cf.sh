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

# 2. Root domain is on Cloudflare nameservers (proves we can deploy
#    Workers + DNS records into this zone). Apex A record is OPTIONAL
#    at L0 — Pages/Workers Routes provision the apex during L1.
ns_records="$(dig +short NS reckon402.com @1.1.1.1 | tr '\n' ',' | sed 's/,$//')"
[[ "$ns_records" == *"ns.cloudflare.com."* ]] \
  || probe_fail "reckon402.com NS not on Cloudflare (got: ${ns_records:-empty})"

root_a="$(dig +short A reckon402.com @1.1.1.1 | grep -E '^[0-9.]+$' | head -n1 || true)"

# 3. Subdomain DNS — soft check, not failure (L1 work).
warnings=()
[[ -z "$root_a" ]] && warnings+=("apex-A-missing")
for sub in agent facilitator gateway signing demo; do
  if [[ -z "$(dig +short "${sub}.reckon402.com" @1.1.1.1 | head -n1)" ]]; then
    warnings+=("${sub}-missing")
  fi
done

# 4. Wrangler dry-run.
PLACEHOLDER_DIR="$DIR/cf-placeholder"
[[ -d "$PLACEHOLDER_DIR" ]] || probe_fail "missing $PLACEHOLDER_DIR"

dry_run_out="$("$WRANGLER" deploy --dry-run --config "$PLACEHOLDER_DIR/wrangler.toml" 2>&1)" \
  || probe_fail "wrangler dry-run failed: $dry_run_out"

note="account=${account_id:-unknown} ns=cloudflare"
if (( ${#warnings[@]} > 0 )); then
  note="$note pending=$(IFS=,; echo "${warnings[*]}")"
fi

probe_pass "$note"

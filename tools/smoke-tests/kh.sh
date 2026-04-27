#!/usr/bin/env bash
# Probe 7 — KeeperHub stub-agent webhook callback.
# See specs/00-l0-smoke-tests.md §7. SKIPs cleanly if no API key.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start kh

KH_KEY="${KEEPERHUB_API_KEY:-$(hydrate KEEPERHUB_API_KEY)}"
if [[ -z "$KH_KEY" ]]; then
  probe_skip "KEEPERHUB_API_KEY not yet provisioned (defer to L4)"
fi

# Real implementation lands once we lock the KH stub-agent flow against
# the live KH API. For L0 commit-2, fail loudly until that happens —
# leaving a SKIP path open via the empty-key check above.
probe_fail "kh.sh body unimplemented; lock KH register/callback flow before L0 run"

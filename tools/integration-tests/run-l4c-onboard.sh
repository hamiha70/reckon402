#!/usr/bin/env bash
# Thin wrapper so justfile can call full-flow-l4c-onboard.sh after Infisical
# injects secrets. SELLER_DEMO_1_PK is mapped from SELLER_PK here, inside
# the Infisical-injected environment where SELLER_PK is already set.
set -euo pipefail
export SELLER_DEMO_1_PK="$SELLER_PK"
cd "$(dirname "$0")"
bash full-flow-l4c-onboard.sh

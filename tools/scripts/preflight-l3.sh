#!/usr/bin/env bash
# Wrapper for preflight-l3.mjs — must run inside infisical-injected env.
# Called by: just preflight-l3 (via tools/with-secrets.sh)
set -euo pipefail

export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$DEPLOYER_AWS_SECRET_ACCESS_KEY"
export AWS_REGION="eu-central-1"
unset AWS_PROFILE

cd "$(git rev-parse --show-toplevel)"
exec node tools/deploy/preflight-l3.mjs

#!/usr/bin/env bash
# Probe 3 — AWS STS + KMS alias + sign-and-recover EOA proof.
# See specs/00-l0-smoke-tests.md §3.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

probe_start aws
require aws
require jq
require node

ALIAS="${KMS_KEY_ALIAS:-alias/reckon402/mainnet/buyer-signer/evm}"
REGION="${AWS_REGION:-eu-central-1}"

# 1. STS get-caller-identity.
sts_out="$(aws sts get-caller-identity --output json 2>&1)" \
  || probe_fail "aws sts get-caller-identity failed: $sts_out"
caller_arn="$(echo "$sts_out" | jq -r '.Arn // empty')"
[[ -n "$caller_arn" ]] || probe_fail "STS returned no Arn"

# 2. KMS alias presence.
list_out="$(aws kms list-aliases --region "$REGION" --output json 2>&1)" \
  || probe_fail "aws kms list-aliases failed: $list_out"

found="$(echo "$list_out" | jq -r --arg a "$ALIAS" \
  '.Aliases[] | select(.AliasName == $a) | .TargetKeyId // empty')"
[[ -n "$found" ]] || probe_fail "alias $ALIAS not found in $REGION (provision per specs/00-l0-smoke-tests.md Provisioning Prerequisites)"

# 3. EOA control proof via lib/kms-verify.mjs.
export AWS_REGION="$REGION"
export KMS_KEY_ALIAS="$ALIAS"
eoa="$(node "$DIR/lib/kms-verify.mjs" 2>&1)" \
  || probe_fail "KMS sign-and-recover failed: $eoa"

probe_pass "caller=${caller_arn##*/} alias=${ALIAS##*/} eoa=${eoa}"

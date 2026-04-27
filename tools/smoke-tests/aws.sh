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

# 2. KMS alias presence — verified by calling kms:GetPublicKey on the
#    alias. This avoids needing kms:ListAliases in the scoped policy
#    (we deliberately keep the policy at kms:Sign + kms:GetPublicKey
#    only). A 404 / NotFoundException would surface as a failure here.
gpk_out="$(aws kms get-public-key --region "$REGION" --key-id "$ALIAS" --output json 2>&1)" \
  || probe_fail "kms:GetPublicKey on $ALIAS failed: $gpk_out"

# 3. EOA control proof via lib/kms-verify.mjs.
export AWS_REGION="$REGION"
export KMS_KEY_ALIAS="$ALIAS"
eoa="$(node "$DIR/lib/kms-verify.mjs" 2>&1)" \
  || probe_fail "KMS sign-and-recover failed: $eoa"

probe_pass "caller=${caller_arn##*/} alias=${ALIAS##*/} eoa=${eoa}"

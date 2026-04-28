#!/usr/bin/env bash
# Return ETH from a reckon402-controlled EOA back to the funder EOA.
# Must run inside infisical-injected env (via: just refund <kind> <amount>).
# Usage: bash tools/scripts/refund.sh <kind> <amount>
#   kind:   deployer | facilitator
#   amount: ETH amount, e.g. 0.1
set -euo pipefail

KIND="${1:-}"
AMOUNT="${2:-}"

if [ -z "$KIND" ] || [ -z "$AMOUNT" ]; then
  echo "usage: just refund <kind> <amount>" >&2
  echo "  kind:   deployer | facilitator" >&2
  echo "  amount: ETH amount, e.g. 0.1" >&2
  exit 1
fi

TO="${X402COMMIT_FUNDER_ADDRESS:-}"
if [ -z "$TO" ]; then
  echo "error: X402COMMIT_FUNDER_ADDRESS not set (hydrate via infisical)" >&2
  exit 1
fi

case "$KIND" in
  deployer)
    PK="${DEPLOYER_PK:-}"
    if [ -z "$PK" ]; then
      echo "error: DEPLOYER_PK not set (hydrate via infisical)" >&2
      exit 1
    fi
    FROM_LABEL="deployer"
    ;;
  facilitator)
    PK="${FACILITATOR_PK:-}"
    if [ -z "$PK" ]; then
      echo "error: FACILITATOR_PK not set (hydrate via infisical)" >&2
      exit 1
    fi
    FROM_LABEL="facilitator"
    ;;
  *)
    echo "error: unknown kind '$KIND' — expected deployer or facilitator" >&2
    exit 1
    ;;
esac

echo "Returning ${AMOUNT} ETH from ${FROM_LABEL} → funder (${TO}) on Base Sepolia..."
exec cast send \
  --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
  --private-key "$PK" \
  --value "${AMOUNT}ether" \
  "$TO"

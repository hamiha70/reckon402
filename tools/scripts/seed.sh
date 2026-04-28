#!/usr/bin/env bash
# Seed an EOA with ETH on Base Sepolia.
# Must run inside infisical-injected env (via: just seed <kind> <amount>).
# Usage: bash tools/scripts/seed.sh <kind> <amount>
#   kind:   deployer | facilitator
#   amount: ETH amount, e.g. 0.1
set -euo pipefail

KIND="${1:-}"
AMOUNT="${2:-}"

if [ -z "$KIND" ] || [ -z "$AMOUNT" ]; then
  echo "usage: just seed <kind> <amount>" >&2
  echo "  kind:   deployer | facilitator" >&2
  echo "  amount: ETH amount, e.g. 0.1" >&2
  exit 1
fi

case "$KIND" in
  deployer)
    TO="${DEPLOYER_EOA:-}"
    if [ -z "$TO" ]; then
      echo "error: DEPLOYER_EOA not set (hydrate via infisical)" >&2
      exit 1
    fi
    ;;
  facilitator)
    TO="${FACILITATOR_ADDRESS:-}"
    if [ -z "$TO" ]; then
      echo "error: FACILITATOR_ADDRESS not set (hydrate via infisical)" >&2
      exit 1
    fi
    ;;
  *)
    echo "error: unknown kind '$KIND' — expected deployer or facilitator" >&2
    exit 1
    ;;
esac

echo "Seeding $KIND ($TO) with ${AMOUNT} ETH on Base Sepolia..."
exec cast send \
  --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
  --private-key "$X402COMMIT_FUNDER_PK" \
  --value "${AMOUNT}ether" \
  "$TO"

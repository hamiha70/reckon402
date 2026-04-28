# ENS resolver update — point reckon402-test.eth at Reckon402Resolver

Operator runbook for the L4a₁ step that wires `reckon402-test.eth` on
Ethereum Sepolia to the deployed `Reckon402Resolver` contract. Run this
AFTER the resolver deploy (`forge script script/DeployResolver.s.sol …`)
and AFTER pinning the address in `deployments/sepolia.json`.

## Pre-flight

```bash
# Verify you have the resolver address (fill in after forge deploy)
cat deployments/sepolia.json | grep address

# Verify owner of reckon402-test.eth is the funder EOA
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash "reckon402-test.eth")
  OWNER=$(cast call "$REGISTRY" "owner(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
  echo "owner: $OWNER"
  # Must match the X402COMMIT_FUNDER address
'
```

## Step 1: set resolver

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  RESOLVER_ADDRESS=<RECKON402_RESOLVER_SEPOLIA>  # from deployments/sepolia.json
  NODE=$(cast namehash "reckon402-test.eth")

  echo "Setting resolver for reckon402-test.eth..."
  TX=$(cast send "$REGISTRY" "setResolver(bytes32,address)" \
    "$NODE" \
    "$RESOLVER_ADDRESS" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" \
    --private-key "$X402COMMIT_FUNDER_PK" \
    --json | jq -r .transactionHash)

  echo "tx: $TX"
  echo "Waiting for confirmation..."
  cast receipt "$TX" --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" --confirmations 1
'
```

Gas estimate: ~30 000. Record the tx hash here after execution.

**L4a₁ actual:** `<TX_HASH_TBD>` (populate post-deploy)

## Step 2: verify

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  RESOLVER_ADDRESS=<RECKON402_RESOLVER_SEPOLIA>
  NODE=$(cast namehash "reckon402-test.eth")

  RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
  echo "resolver: $RESOLVER"
  # Must equal $RESOLVER_ADDRESS
'
```

## Step 3: smoke-test via OffchainLookup revert

With the resolver set, a call to `resolve(name, data)` on `Reckon402Resolver`
should revert with `OffchainLookup`. Confirm via:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  RESOLVER_ADDRESS=<RECKON402_RESOLVER_SEPOLIA>
  # DNS-encode "reckon402-test.eth" and call resolve() — expect revert
  cast call "$RESOLVER_ADDRESS" \
    "resolve(bytes,bytes)(bytes)" \
    "$(cast --from-utf8 reckon402-test.eth | xxd -r -p | xxd -p)" \
    "0x" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"
  # Expect: error OffchainLookup(...)
'
```

If you see `OffchainLookup` in the error output, the resolver is live and
pointing at the gateway URL.

## Etherscan link

https://sepolia.etherscan.io/tx/<TX_HASH_TBD>

## When to re-run

Re-run only if:
- The deployed `Reckon402Resolver` address changes (new deploy).
- A different ENS name needs to be pointed at the resolver.

Never run as part of CI — resolver updates are operator-authorised.

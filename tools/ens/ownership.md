# ENS name ownership record

Documents current ownership of reckon402-controlled ENS names, verified
at L4a₁ session start (2026-04-28). Auditable closure for the L0 task of
confirming funder EOA owns `reckon402-test.eth` before wiring the CCIP-Read
resolver.

## reckon402-test.eth (Ethereum Sepolia)

| Field | Value |
|-------|-------|
| Name | `reckon402-test.eth` |
| Chain | Ethereum Sepolia (chainId 11155111) |
| ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| Owner (registry) | `0x9AF7…3F04` (funder EOA, `X402COMMIT_FUNDER_PK` in Infisical) |
| Resolver (current) | `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5` (Sepolia PublicResolver, pre-L4a₁) |
| `addr()` (current) | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` (seller EOA) |
| Wrapped | No — `registry.owner(node) == funder EOA` directly |
| Registered | 2026-04-27, 1-year lease |
| Registration tx | `0xd9725e9c92c20be8b9788e5caae4711c63c36ef5efb7e91dcd56e4e9ed121d59` (block 10742776) |

**Verified 2026-04-28** by running the lookup from `tools/ens/set-record.md`:
```bash
infisical run --env dev -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash "reckon402-test.eth")
  cast call "$REGISTRY" "owner(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"
'
# Returns: 0x9AF7...3F04 (funder EOA)
```

## L4a₁ planned change

After `Reckon402Resolver` is deployed to Sepolia, the resolver record for
`reckon402-test.eth` will be updated from the Sepolia PublicResolver to
the new `Reckon402Resolver` address via:

```bash
cast send <ENS_REGISTRY> "setResolver(bytes32,address)" <node> <Reckon402Resolver>
  --rpc-url $ETH_SEPOLIA_RPC_PRIMARY
  --private-key $X402COMMIT_FUNDER_PK
```

See `tools/ens/set-resolver.md` for the full runbook (created in L4a₁).
The resolver address will be recorded in `deployments/sepolia.json` and
this file will be updated with the actual tx hash post-deploy.

## How to re-verify

```bash
infisical run --env dev -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NAME=reckon402-test.eth
  NODE=$(cast namehash "$NAME")
  OWNER=$(cast call "$REGISTRY" "owner(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
  RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
  echo "owner    : $OWNER"
  echo "resolver : $RESOLVER"
'
```

# ENS records on Mainnet — reckon402.eth

Operator runbook for registering `reckon402.eth` on Ethereum Mainnet and
wiring it to the deployed `Reckon402Resolver` contract. Run this AFTER
`tools/deploy/deploy-resolver-mainnet.md` completes and the resolver address
is pinned in `contracts/deployments/mainnet.json`.

**Purpose:** `reckon402.eth` on mainnet is a credibility/prize signal.
The demo continues to run on Sepolia (`reckon402-test.eth`). Mainnet text
records point at Sepolia infrastructure where necessary — this is documented
explicitly in each step.

All commands assume repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

---

## Registration cost estimates

| Item | Estimate |
|---|---|
| `reckon402.eth` 1-year mainnet registration | ~$5–20 USD in ETH (gas + ~0.0032 ETH rent at current rates) |
| `setResolver` tx | ~30 000 gas (~0.0006 ETH at 20 gwei) |
| `setAddr` tx | ~42 000 gas (~0.0008 ETH at 20 gwei) |
| Each `setText` tx | ~50 000–70 000 gas (~0.001–0.0014 ETH at 20 gwei) per record |
| **Total (5 text records + setAddr + setResolver)** | **≈ 0.015–0.025 ETH** plus registration rent |

Gas price at time of execution will vary. Budget 0.05 ETH for the full
sequence to be safe.

**No SepETH is spent here** — all mainnet transactions use mainnet ETH from
the registrant's wallet.

---

## Step 0 — Verify resolver is deployed

```bash
RESOLVER_MAINNET=$(cat contracts/deployments/mainnet.json | jq -r '.Reckon402Resolver.address')
echo "Mainnet resolver: $RESOLVER_MAINNET"

infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cast code '"$RESOLVER_MAINNET"' --rpc-url "$ETH_MAINNET_RPC_PRIMARY" | wc -c
'
# Expect: > 10 (non-empty bytecode)
```

---

## Step 1 — Register reckon402.eth (UI)

Registration is a UI action — `app.ens.domains` runs the commit-reveal flow
more reliably than a hand-rolled `cast` script and is required for the
NameWrapper wrapping step that mainnet ENS v2 defaults to.

1. Fund the registrant wallet with ≥ 0.05 ETH (see cost table above).
   Use whichever EOA will own `reckon402.eth` long-term — this becomes
   the ENS registry owner. Record it as `RECKON402_ENS_OWNER_ADDRESS`.

2. Import that wallet into MetaMask (if using a project key, import as a
   temporary account; remove it after registration).

3. Switch MetaMask to **Ethereum Mainnet**.

4. Go to <https://app.ens.domains> → connect wallet → search
   `reckon402.eth` → register for 1 year.

5. Three transactions: **Commit**, wait ~1 minute (commit-reveal delay),
   then **Register**. Optionally set the `addr` record in the UI during
   registration (saves one tx later).

6. After registration lands, verify in the UI:
   - Owner = your registrant EOA
   - Resolver = ENS Public Resolver (the default; we override this next)

7. Remove the imported account from MetaMask if you imported a project PK.

Record the registration tx hash here after execution:
- **Registration tx:** `<TX_HASH_TBD>`
- **ENS owner (registrant) EOA:** `<RECKON402_ENS_OWNER_ADDRESS>`

---

## Step 2 — Set resolver to Reckon402Resolver

Point `reckon402.eth` at the deployed mainnet resolver so CCIP-Read fires on
lookups instead of the default PublicResolver.

```bash
RESOLVER_MAINNET=$(cat contracts/deployments/mainnet.json | jq -r '.Reckon402Resolver.address')

infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash "reckon402.eth")

  echo "Setting resolver for reckon402.eth -> '"$RESOLVER_MAINNET"'"
  TX=$(cast send "$REGISTRY" "setResolver(bytes32,address)" \
    "$NODE" \
    '"$RESOLVER_MAINNET"' \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY" \
    --private-key "$ETH_MAINNET_DEPLOYER_PK" \
    --json | jq -r .transactionHash)

  echo "setResolver tx: $TX"
  cast receipt "$TX" --rpc-url "$ETH_MAINNET_RPC_PRIMARY" --confirmations 1
'
```

Gas estimate: ~30 000. Record tx hash:
- **setResolver tx:** `<TX_HASH_TBD>`

Verify:

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash "reckon402.eth")
  RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY")
  echo "resolver: $RESOLVER"
'
# Must equal $RESOLVER_MAINNET
```

---

## Step 3 — setAddr (Ethereum address record)

Sets what `getEnsAddress("reckon402.eth")` returns — the platform's primary
resolution target.

```bash
RESOLVER_MAINNET=$(cat contracts/deployments/mainnet.json | jq -r '.Reckon402Resolver.address')

infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  NODE=$(cast namehash "reckon402.eth")

  # Set addr to the deployer EOA (or any platform-owned mainnet address).
  # This is the forward resolution result; it does not affect CCIP-Read
  # text record lookups, which go through resolve() -> OffchainLookup.
  cast send '"$RESOLVER_MAINNET"' "setAddr(bytes32,address)" \
    "$NODE" \
    "$(cast wallet address --private-key $ETH_MAINNET_DEPLOYER_PK)" \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY" \
    --private-key "$ETH_MAINNET_DEPLOYER_PK"
'
```

**Note:** `setAddr` on `Reckon402Resolver` is an Ownable-gated call — the
resolver inherits `Ownable` but does not implement `setAddr` itself (it is a
pure CCIP-Read resolver, not a storage resolver). The `addr` record for
`reckon402.eth` should instead be set on the ENS PublicResolver before
switching the resolver, OR set on any storage layer that the CCIP-Read
gateway serves.

**Practical path:** set the `addr` record in the ENS Manager UI during
registration (step 1), pointing at the platform EOA. Once the resolver is
switched to `Reckon402Resolver`, `addr` lookups will go through CCIP-Read
and the gateway must serve a `coinType=60` record from D1. If D1 does not
have an `addr` entry for `reckon402.eth`, the lookup returns empty. This is
acceptable for the demo (only text records are exercised). Leave `addr`
pointing at the PublicResolver value set during registration if you want a
stable forward resolution without D1 dependency.

---

## Step 4 — setText: ENSIP-25 / ERC-8004 records

These two records identify Reckon402 as the platform in the CAIP-2 registry
(see `specs/ensip25_erc8004.md`). They are **platform-owned records**
(Reckon402 writes them, not SellingAgents) per the ACL design in
`tools/ens/ownership.md`.

Both writes call `setText` on the `Reckon402Resolver`. Because
`Reckon402Resolver` is a pure CCIP-Read resolver and does NOT implement
`setText` for on-chain storage, these records are written via the gateway's
`/admin/records` API (signed write), not via `cast send`.

### 4a — x402.erc8004.registry

```bash
# Signed write to the gateway admin API (same pattern as SellingAgent onboarding).
# The value follows ERC-8004 §4: "eip155:1" for Ethereum mainnet.
curl -X POST https://gateway.reckon402.com/admin/records \
  -H "Content-Type: application/json" \
  -d '{
    "ensName": "reckon402.eth",
    "key":     "x402.erc8004.registry",
    "value":   "eip155:1",
    "sig":     "<RECKON402_ONBOARDING_EOA_SIGNATURE>"
  }'
```

The `sig` field is an EIP-191 signature of the canonical write payload
(see `specs/08b-l4c-onboarding-frontend.md` §5 for the signing scheme).

### 4b — x402.erc8004.agent_id

```bash
curl -X POST https://gateway.reckon402.com/admin/records \
  -H "Content-Type: application/json" \
  -d '{
    "ensName": "reckon402.eth",
    "key":     "x402.erc8004.agent_id",
    "value":   "reckon402.eth",
    "sig":     "<RECKON402_ONBOARDING_EOA_SIGNATURE>"
  }'
```

The `agent_id` for the platform root name is the name itself.

---

## Step 5 — setText: x402.facilitator

Points to the Reckon402 facilitator endpoint. This record is read by
BuyingAgents constructing x402 payment headers.

```bash
curl -X POST https://gateway.reckon402.com/admin/records \
  -H "Content-Type: application/json" \
  -d '{
    "ensName": "reckon402.eth",
    "key":     "x402.facilitator",
    "value":   "https://facilitator.reckon402.com",
    "sig":     "<RECKON402_ONBOARDING_EOA_SIGNATURE>"
  }'
```

---

## Step 6 — setText: x402.splitter

**Important:** the demo Splitter contract is deployed on **Base Sepolia**
(not mainnet). The `x402.splitter` record for `reckon402.eth` deliberately
points at the Sepolia Splitter address. This is intentional — the demo
settlement flow uses Sepolia USDC and Sepolia gas. Any mainnet-resolution
consumer that reads `x402.splitter` and tries to call it on mainnet will
find no contract at that address; that is the expected behavior during the
demo period.

```bash
# SPLITTER_ADDRESS is the Base Sepolia Splitter for the platform root name.
# Get it from AGENTS.md ## L3 deployments.
SPLITTER_ADDRESS="<BASE_SEPOLIA_SPLITTER_ADDRESS>"

curl -X POST https://gateway.reckon402.com/admin/records \
  -H "Content-Type: application/json" \
  -d '{
    "ensName": "reckon402.eth",
    "key":     "x402.splitter",
    "value":   "'"$SPLITTER_ADDRESS"'",
    "sig":     "<RECKON402_ONBOARDING_EOA_SIGNATURE>"
  }'
```

Document this cross-chain pointer in AGENTS.md:

```
x402.splitter on reckon402.eth (mainnet name) = <BASE_SEPOLIA_SPLITTER_ADDRESS>
(Base Sepolia; intentional — demo runs on Sepolia, mainnet ENS is credibility signal only)
```

---

## Step 7 — Verify records via CCIP-Read

After the gateway has all five records in D1, verify end-to-end resolution
for each key. These calls exercise the full CCIP-Read path: mainnet ENS
registry → Reckon402Resolver (mainnet) → OffchainLookup → gateway →
signed response.

```bash
# Requires a CCIP-Read-aware client. Use cast's --ccip-read flag (Foundry ≥ 0.2.0):
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  for KEY in x402.erc8004.registry x402.erc8004.agent_id x402.facilitator x402.splitter; do
    echo -n "$KEY: "
    cast resolve-ens --ccip-read "reckon402.eth" \
      --rpc-url "$ETH_MAINNET_RPC_PRIMARY" 2>/dev/null \
      || echo "(cast resolve-ens does not support text; use a custom call)"
  done
'
```

`cast` does not expose `text()` lookups directly via `resolve-ens`. Use a
direct `eth_call` with the Universal Resolver or query the gateway directly:

```bash
# Direct gateway query (bypasses on-chain; useful for smoke check):
for KEY in x402.erc8004.registry x402.erc8004.agent_id x402.facilitator x402.splitter; do
  echo -n "$KEY: "
  curl -s "https://gateway.reckon402.com/lookup?name=reckon402.eth&key=$KEY" | jq -r .value
done
```

Expected values:

| Key | Expected value |
|---|---|
| `x402.erc8004.registry` | `eip155:1` |
| `x402.erc8004.agent_id` | `reckon402.eth` |
| `x402.facilitator` | `https://facilitator.reckon402.com` |
| `x402.splitter` | `<BASE_SEPOLIA_SPLITTER_ADDRESS>` |

---

## Step 8 — AGENTS.md + update

After all steps are green, add to AGENTS.md under `## Mainnet ENS`:

- Registration tx + block
- setResolver tx
- Resolver address (from `contracts/deployments/mainnet.json`)
- Record values as set

---

## Rollback

| Situation | Action |
|---|---|
| Wrong resolver set | `cast send REGISTRY "setResolver(bytes32,address)" NODE <OLD_RESOLVER>` |
| Wrong text record | Re-POST to `/admin/records` with corrected value |
| Need to remove a record | POST `value: ""` to `/admin/records` (gateway treats empty string as delete) |
| Want to revert to PublicResolver | Use ENS Manager UI — connect owner wallet → set resolver back to default |

There is no on-chain undo for `setText` on a storage resolver, but the
gateway D1 records are mutable at any time via `/admin/records`.

---

## References

- `tools/deploy/deploy-resolver-mainnet.md` — resolver deploy (run first)
- `tools/ens/set-record.md` — Sepolia counterpart (same pattern)
- `tools/ens/set-resolver.md` — setResolver reference
- `contracts/deployments/mainnet.json` — mainnet resolver address
- `specs/08b-l4c-onboarding-frontend.md` — signed-write API spec
- `workers/facilitator/src/treasury/agent-resolver.ts` — how the facilitator
  reads x402.splitter

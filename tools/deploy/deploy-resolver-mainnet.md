# Deploy Runbook — Reckon402Resolver on Ethereum Mainnet

Deploy a fresh instance of `Reckon402Resolver` to Ethereum Mainnet and wire
it into the gateway config. The Sepolia instance at
`0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a` is **not touched** — this
runbook is additive only.

**Purpose:** credibility/prize signal. The demo continues to run on Sepolia.
Mainnet registration of `reckon402.eth` proves the platform is real; resolving
via CCIP-Read at the same `gateway.reckon402.com` URL confirms end-to-end
infrastructure. No mainnet tokens change hands in the demo.

**Paired runbook:** `tools/ens/set-records-mainnet.md` (register + wire ENS
after this deploy completes).

All commands assume repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

---

## Pre-conditions

- [ ] Working tree clean on `main`.
- [ ] Sepolia resolver is live and healthy:
      `curl -s https://gateway.reckon402.com/healthz | jq .status` → `"ok"`.
- [ ] Infisical `--env prod` hydrates:
      - `ETH_MAINNET_RPC_PRIMARY` (Alchemy or Infura mainnet endpoint)
      - `ETH_MAINNET_DEPLOYER_PK` (mainnet deployer EOA private key)
      - `RECKON402_RESOLVER_SIGNER_ADDRESS` (same hot-signer as Sepolia)
      - `ETHERSCAN_API_KEY`
      - `GATEWAY_URL` = `"https://gateway.reckon402.com/lookup/{sender}/{data}"`
- [ ] Deployer EOA is funded with ≥ 0.01 ETH (deploy costs ~0.005 ETH at
      20 gwei; include headroom for gas spikes).

Check balance:

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cast balance \
    $(cast wallet address --private-key "$ETH_MAINNET_DEPLOYER_PK") \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY"
'
```

---

## Step 1 — Forge unit gate

Run the resolver test suite (no mainnet-specific tests; we gate on the same
unit suite that guarded the Sepolia deploy):

```bash
(cd contracts && forge test --match-path "test/Reckon402Resolver*" -vv)
```

Must exit 0. Any failure is a STOP.

If no `Reckon402Resolver`-specific test file exists yet, run the full suite:

```bash
(cd contracts && forge build && forge test -vv)
```

---

## Step 2 — Dry-run (no broadcast)

Confirm constructor args encode correctly and the RPC responds:

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cd contracts
  forge script script/DeployReckon402ResolverMainnet.s.sol:DeployReckon402ResolverMainnet \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY" \
    --private-key "$ETH_MAINNET_DEPLOYER_PK" \
    -vvv
' | tee /tmp/resolver-mainnet-dryrun.log
```

Confirm the log shows:
- `Reckon402Resolver (mainnet) deployed at: <SIMULATED_ADDR>`
- `Initial signer: 0x...` (matches Sepolia hot signer)
- `Gateway URL: https://gateway.reckon402.com/lookup/{sender}/{data}`

If the script errors with `missing env var`, check Infisical env name is
`prod` (not `dev`).

---

## Step 3 — Deploy to Mainnet

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cd contracts
  forge script script/DeployReckon402ResolverMainnet.s.sol:DeployReckon402ResolverMainnet \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY" \
    --private-key "$ETH_MAINNET_DEPLOYER_PK" \
    --broadcast \
    --verify \
    --verifier-url https://api.etherscan.io/api \
    --etherscan-api-key "$ETHERSCAN_API_KEY" \
    -vvv
' | tee /tmp/resolver-mainnet-deploy.log
```

Capture from the output:

- **Resolver address** — `<RESOLVER_MAINNET_ADDRESS>` (e.g. `0x...`)
- **Deploy tx hash** — `<DEPLOY_TX_HASH>`
- **Block number** — `<DEPLOY_BLOCK>`

The `--verify` flag submits to Etherscan automatically. Verification can take
30–90 seconds; the script waits inline. If it times out with
`"Contract code not yet propagated"`, re-run verification standalone:

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cd contracts
  forge verify-contract \
    <RESOLVER_MAINNET_ADDRESS> \
    src/Reckon402Resolver.sol:Reckon402Resolver \
    --chain mainnet \
    --etherscan-api-key "$ETHERSCAN_API_KEY" \
    --constructor-args $(cast abi-encode \
        "constructor(string[],address)" \
        '["https://gateway.reckon402.com/lookup/{sender}/{data}"]' \
        "$RECKON402_RESOLVER_SIGNER_ADDRESS")
'
```

Etherscan verified badge: `https://etherscan.io/address/<RESOLVER_MAINNET_ADDRESS>#code`

---

## Step 4 — Pin address + update gateway wrangler.toml

### 4a — Create deployments/mainnet.json

```bash
mkdir -p contracts/deployments
cat > contracts/deployments/mainnet.json <<EOF
{
  "network": "mainnet",
  "chainId": 1,
  "Reckon402Resolver": {
    "address": "<RESOLVER_MAINNET_ADDRESS>",
    "deployTx": "<DEPLOY_TX_HASH>",
    "deployBlock": <DEPLOY_BLOCK>,
    "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "gatewayUrl": "https://gateway.reckon402.com/lookup/{sender}/{data}",
    "signer": "<RECKON402_RESOLVER_SIGNER_ADDRESS>"
  }
}
EOF
```

### 4b — Update gateway/wrangler.toml

Add `ETH_MAINNET_RESOLVER_ADDRESS` to the `[vars]` block and each named env
(`[env.production.vars]`, `[env.staging.vars]`):

```diff
 [vars]
 RESOLVER_CONTRACT_ADDRESS_SEPOLIA = "0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a"
+ETH_MAINNET_RESOLVER_ADDRESS      = "<RESOLVER_MAINNET_ADDRESS>"
 ENABLE_ERC8004_READS              = "true"
```

Repeat for `[env.production.vars]` and `[env.staging.vars]`.

Also add the binding to `gateway/src/env.ts`:

```diff
   RECKON402_ONBOARDING_EOA: string
+  ETH_MAINNET_RESOLVER_ADDRESS: string
+  ETH_MAINNET_RPC_PRIMARY: string
 }
```

`ETH_MAINNET_RESOLVER_ADDRESS` is a public address — use `[vars]`, not a
secret. `ETH_MAINNET_RPC_PRIMARY` may contain an API key; use
`wrangler secret put ETH_MAINNET_RPC_PRIMARY --env production`.

Commit:

```bash
git add contracts/deployments/mainnet.json gateway/wrangler.toml gateway/src/env.ts
git commit -m 'deploy(mainnet): pin Reckon402Resolver mainnet address + gateway wrangler var'
```

---

## Step 5 — Smoke-test via cast

### 5a — Resolver owner

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cast call <RESOLVER_MAINNET_ADDRESS> \
    "owner()(address)" \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY"
'
# Expect: deployer EOA address
```

### 5b — Authorized signer

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cast call <RESOLVER_MAINNET_ADDRESS> \
    "signers(address)(bool)" \
    "$RECKON402_RESOLVER_SIGNER_ADDRESS" \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY"
'
# Expect: true
```

### 5c — Gateway URL stored

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  cast call <RESOLVER_MAINNET_ADDRESS> \
    "gatewayUrls(uint256)(string)" \
    0 \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY"
'
# Expect: "https://gateway.reckon402.com/lookup/{sender}/{data}"
```

### 5d — OffchainLookup revert (end-to-end resolver liveness)

After `reckon402.eth` is registered and pointed at this resolver (see
`tools/ens/set-records-mainnet.md`), confirm the CCIP-Read revert fires:

```bash
infisical run --env prod --domain https://secrets.intentralabs.com -- bash -c '
  NAME_NODE=$(cast namehash "reckon402.eth")
  # DNS-encode "reckon402.eth" (5 bytes label + 3 bytes label + 0x00 terminator)
  DNS_NAME=0x09007265636b6f6e3430320365746800
  INNER=$(cast abi-encode "text(bytes32,string)" "$NAME_NODE" "x402.facilitator")

  cast call <RESOLVER_MAINNET_ADDRESS> \
    "resolve(bytes,bytes)(bytes)" \
    "$DNS_NAME" \
    "$INNER" \
    --rpc-url "$ETH_MAINNET_RPC_PRIMARY" 2>&1 | grep -i "OffchainLookup"
'
# Expect: line containing "OffchainLookup" in the revert reason
```

---

## Step 6 — AGENTS.md + tag

After steps 3–5 are green, record in AGENTS.md under a new
`## Mainnet Resolver` section:

- Resolver address
- Deploy tx + block
- Etherscan link
- Signer address (Sepolia hot signer reused)

Then tag:

```bash
git tag -a mainnet-resolver-deployed \
  -m "mainnet: Reckon402Resolver deployed at <RESOLVER_MAINNET_ADDRESS>
CCIP-Read gateway: gateway.reckon402.com
Sepolia resolver unchanged at 0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a
ENS records: see tools/ens/set-records-mainnet.md"
git push --follow-tags
```

---

## Rollback protocol

The Reckon402Resolver contract holds no funds and no mutable settlement state.
"Rollback" means stop pointing `reckon402.eth` at it.

1. **Fastest:** via ENS Manager UI — update the resolver on `reckon402.eth`
   back to the ENS PublicResolver. No re-deploy needed; the contract remains
   on-chain but is no longer the active resolver.
2. **Gateway var:** remove or blank `ETH_MAINNET_RESOLVER_ADDRESS` in
   wrangler.toml and redeploy the gateway if any gateway route was added
   that reads it. At present the gateway serves the same data regardless of
   which chain calls it (chain-agnostic CCIP-Read — see note below), so this
   is a no-op unless chain-routing was added.
3. **Contract owner:** the deployer EOA owns the contract; it can call
   `setGatewayUrls([])` to break CCIP-Read for any resolver that still points
   at it, or call `removeSigner(signer)` to invalidate all signed responses.
   These are emergency nuclear options only.

---

## Failure diagnostics

| Symptom | Likely cause | Fix |
|---|---|---|
| `forge script` fails: `"missing env var GATEWAY_URL"` | Infisical `--env prod` not resolving | Check Infisical project has `GATEWAY_URL` under `prod` environment |
| `forge script` fails: `"insufficient funds"` | Deployer EOA underfunded | Top up; check balance in pre-conditions |
| Etherscan verify timeout | Propagation lag | Re-run `forge verify-contract` standalone (step 3) |
| `cast call signers(address)(bool)` returns `false` | Signer address mismatch | Verify `RECKON402_RESOLVER_SIGNER_ADDRESS` matches what was passed to constructor; check `contracts/deployments/mainnet.json` |
| `cast call resolve(...)` does NOT revert with `OffchainLookup` | ENS not yet pointing at this resolver | Run `tools/ens/set-records-mainnet.md` step 2 first |
| `OffchainLookup` fires but gateway returns 500 | Gateway can't sign response | Confirm `RECKON402_RESOLVER_SIGNER_PK` is set as a production gateway secret |

---

## Chain-agnostic gateway note

The existing CCIP-Read gateway at `gateway.reckon402.com` resolves records from
its D1 database keyed by ENS name + record key. It does **not** inspect the
`sender` (resolver address) to determine which chain the lookup came from —
D1 holds canonical records independent of chain. This means the same gateway
URL serves both the Sepolia and mainnet resolver instances without any code
change. See `gateway/src/routes/lookup.ts` (`handleLookup`) — `sender` is
passed to `signCcipResponse` only for digest binding, not for data routing.
A `chain-router.ts` module is therefore not needed; this architecture is
intentional.

---

## References

- `contracts/script/DeployReckon402ResolverMainnet.s.sol` — deploy script
- `contracts/script/DeployResolver.s.sol` — Sepolia counterpart
- `tools/ens/set-records-mainnet.md` — post-deploy ENS wiring
- `gateway/src/routes/lookup.ts` — CCIP-Read handler (chain-agnostic)
- `tools/deploy/deploy-l4c-factory.md` — runbook structure pattern

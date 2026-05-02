# L4d Deploy Runbook — EscrowFactory + per-agent Escrow

Operator-driven on-chain deploy for the L4d on-chain risk-buffer
Escrow. Lands an `EscrowFactory` on Base Sepolia + smoke-tests a
single per-agent Escrow before any orchestrator changes ship. Until
the orchestrator is updated (E2), this factory exists silently — no
existing onboarding flow uses it. seller9 is unaffected at every
step.

**Paired spec:** `specs/09-l4d-escrow.md`.
**Predecessor:** L4c factory pattern (`tools/deploy/deploy-l4c-factory.md`).
**Rollback baseline:** `L4d-pre-onchain-baseline` (`8a468ec`) — reset
to here if any step fails irrecoverably.

All commands assume you start in the repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

---

## Pre-conditions

- [ ] `L4d-contracts-green` tag is at HEAD or earlier (forge build +
      forge test green from a fresh clone).
- [ ] Working tree is clean.
- [ ] Fresh-clone reproducibility: `git clean -fdx && pnpm install &&
      (cd contracts && forge build && forge test) && pnpm -r run test`
      exits 0. Forge: 95/95 (= 49 pre-L4d + 46 L4d). Vitest: same as
      pre-L4d (no worker changes in this layer).
- [ ] Infisical hydrates: `BASE_SEPOLIA_RPC_PRIMARY`,
      `DEPLOYER_AWS_ACCESS_KEY_ID`, `DEPLOYER_AWS_SECRET_ACCESS_KEY`
      (these route the AWS SDK to the `reckon402-deployer` IAM user
      that has `kms:Sign` + `kms:GetPublicKey` on the deployer key
      alias `alias/reckon402/mainnet/deployer/evm`, controlling EOA
      `0x66C2858D9A8605957c516a77262Eb66EE6be113C`),
      and `RECKON402_DEPLOYER_PK` (the L4c orchestrator's
      software-key for cast probes — distinct from the KMS deployer
      EOA; used by step 3's probe deploy because cast cannot sign
      with KMS).
- [ ] Deployer (KMS) has ≥ 0.02 ETH on Base Sepolia for the factory
      deploy. The Step 3 probe Escrow is signed by
      `RECKON402_DEPLOYER_PK` (facilitator EOA) so its balance must
      also be ≥ 0.005 ETH.

---

## Step 0 — Preflight

```bash
just preflight-l3
```

Must exit 0. L4d adds no new chain probes beyond the deployer balance
check.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  echo "KMS deployer (factory deploy):"
  cast balance 0x66C2858D9A8605957c516a77262Eb66EE6be113C \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
  echo "Software deployer (probe Escrow + smoke):"
  cast balance 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455 \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
'
```

Expect both ≥ 0.02 ETH (in wei: ≥ 20000000000000000).

---

## Step 1 — Forge gate

```bash
(cd contracts && forge test --match-contract "EscrowTest|EscrowFactoryTest" -vv)
```

Must exit 0 with **46/46 passing** (32 EscrowTest + 14 EscrowFactoryTest,
including the 256-run fuzz on `predictAddress↔createEscrow`). Any
fuzz failure is a STOP — it means the CREATE2 prediction disagrees
with the EVM's actual deployed address; never broadcast a factory
that fails this test.

---

## Step 2 — Deploy EscrowFactory on Base Sepolia (KMS-signed)

Pinned constructor args (hardcoded in `tools/deploy/deploy-escrow-factory.mjs`,
NOT the Foundry script — the Node + viem + KMS path is the canonical
deploy for any Reckon402 contract that records the KMS deployer EOA):

| Param | Value | Source |
|-------|-------|--------|
| token              | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | USDC Base Sepolia (AGENTS.md L3) |
| identityRegistry   | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | ERC-8004 IdentityRegistry (AGENTS.md L4a2) |
| reputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | ERC-8004 ReputationRegistry (AGENTS.md L4a2) |

Build artifact first, then deploy:

```bash
(cd contracts && forge build)

infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  node tools/deploy/deploy-escrow-factory.mjs
' | tee /tmp/l4d-factory-deploy.log
```

The deploy script:
1. Resolves the deployer address from KMS (`alias/reckon402/mainnet/deployer/evm`) via `tools/sign/kms-account.mjs`.
2. Re-checks the on-chain balance ≥ 0.01 ETH.
3. Encodes the constructor args, prepends to bytecode.
4. Signs with KMS, broadcasts, waits for receipt (120s timeout).
5. Writes `contracts/deploy-logs/escrow-factory-base-sepolia-<DATE>.md`.
6. Stdout = the deployed factory address (for `$(...)` capture).

The `Foundry forge script` flow under `script/DeployEscrowFactory.s.sol`
is retained for local Anvil testing only — it CANNOT sign with KMS.

The deploy script's stdout is the factory address; capture into a shell variable for the next steps.

Capture from the broadcast output:
- **EscrowFactory address** — `<TBD>`
- **Deploy tx hash** — `<TBD>`
- **Block number** — `<TBD>`
- **Gas used** — `<TBD>`

Sanity reads:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  FACTORY="<EscrowFactory address>"
  echo "token():            $(cast call $FACTORY "token()(address)"             --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY")"
  echo "identityRegistry(): $(cast call $FACTORY "identityRegistry()(address)"  --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY")"
  echo "reputationRegistry: $(cast call $FACTORY "reputationRegistry()(address)" --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY")"
'
```

Expected output (case-normalized):
```
token():            0x036CbD53842c5426634e7929541eC2318f3dCF7e
identityRegistry(): 0x8004A818BFB912233c491871b3d84c89A494BD9e
reputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
```

If any of those mismatch, **STOP** — the factory was deployed with
wrong constructor args. Re-deploy.

---

## Step 3 — Deploy a probe Escrow via the factory

Tests the full per-agent deploy path with a real on-chain agent.
Picks an existing seller's agentId so the ReputationRegistry already
has rows (the Escrow's tier evaluation will return non-zero).

Use **agentId = 1** — `seller.reckon402-test.eth` per AGENTS.md L4a2
(Base Sepolia). This agent already has L4b1 attestation rows.

Tier curve passed to the Escrow:

```
thresholds = [0, 1, 3, 10, 30, 100, 300, 1000]
releaseBps = [0, 500, 1500, 3000, 5000, 7000, 8500, 10000]
```

Salt: `keccak256("reckon402-l4d-probe-2026-05-02")`.

The probe Escrow is signed by `RECKON402_DEPLOYER_PK` (facilitator
software EOA `0x0A0228E6...`), NOT the KMS deployer. The factory has
no admin function — anyone can call `createEscrow`. This keeps the
probe deploy on a hot key path so we can iterate quickly without
KMS round-trips for a single smoke probe.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  FACTORY="<EscrowFactory address from step 2>"
  FACILITATOR=0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455
  AGENT_ID=1
  SALT=$(cast keccak "reckon402-l4d-probe-2026-05-02")

  # First predict the address (read-only, no gas).
  PREDICTED=$(cast call "$FACTORY" \
    "predictAddress(uint256,address,uint64[],uint16[],string,string,bytes32)(address)" \
    "$AGENT_ID" \
    "$FACILITATOR" \
    "[0,1,3,10,30,100,300,1000]" \
    "[0,500,1500,3000,5000,7000,8500,10000]" \
    "payment" \
    "x402-settlement" \
    "$SALT" \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY")

  echo "Predicted Escrow address: $PREDICTED"

  # Now deploy.
  cast send "$FACTORY" \
    "createEscrow(uint256,address,uint64[],uint16[],string,string,bytes32)(address)" \
    "$AGENT_ID" \
    "$FACILITATOR" \
    "[0,1,3,10,30,100,300,1000]" \
    "[0,500,1500,3000,5000,7000,8500,10000]" \
    "payment" \
    "x402-settlement" \
    "$SALT" \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
    --private-key "$RECKON402_DEPLOYER_PK"
' | tee /tmp/l4d-probe-escrow.log
```

Capture:
- **Probe Escrow address** — `<should equal $PREDICTED>`
- **Probe deploy tx** — `<TBD>`

---

## Step 4 — Smoke: read state from the probe Escrow

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  ESCROW="<probe escrow address>"
  RPC="$BASE_SEPOLIA_RPC_PRIMARY"

  echo "owner():              $(cast call $ESCROW "owner()(address)"         --rpc-url $RPC)"
  echo "agentId():            $(cast call $ESCROW "agentId()(uint256)"       --rpc-url $RPC)"
  echo "attestationCount():   $(cast call $ESCROW "attestationCount()(uint64)" --rpc-url $RPC)"
  echo "releasedBps():        $(cast call $ESCROW "releasedBps()(uint16)"    --rpc-url $RPC)"
  echo "totalDeposited():     $(cast call $ESCROW "totalDeposited()(uint256)" --rpc-url $RPC)"
  echo "currentlyHeld():      $(cast call $ESCROW "currentlyHeld()(uint256)"  --rpc-url $RPC)"
  echo "totalWithdrawn:       $(cast call $ESCROW "totalWithdrawn()(uint256)" --rpc-url $RPC)"
'
```

Expected:
- `owner()` returns the seller EOA that owns agentId=1 in the
  IdentityRegistry (look up via Basescan; should be the seller of
  `seller.reckon402-test.eth`).
- `agentId()` returns `1`.
- `attestationCount()` returns the number of L4b1 attestations
  written by the facilitator EOA for agentId=1 with tags
  (`payment`, `x402-settlement`). Per AGENTS.md L4b1 first-attestation
  log this should be ≥ 1 already.
- `releasedBps()` is the tier corresponding to that count (with the
  default curve, 1 attestation → 500 = 5%).
- `totalDeposited()` and `currentlyHeld()` return 0 — the probe Escrow
  is empty; this is expected.
- `totalWithdrawn` returns 0.

Any cast revert here is a STOP — debug before proceeding.

---

## Step 5 — Smoke: non-owner withdraw must revert

We use `cast call` (read-only, doesn't broadcast) with `--from` set
to the facilitator EOA. This routes through the EVM as if a write
were attempted, so all reverts surface, but no gas is spent.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  ESCROW="<probe escrow address>"
  cast call "$ESCROW" "withdraw(uint256)" 1 \
    --from 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455 \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
'
```

Expected: revert with `NotOwner()` selector (`0x30cd7471`).
The output should be along the lines of:
```
execution reverted, data: "0x30cd7471"  (NotOwner)
```

If the call succeeds (no revert), **STOP** — the owner check is broken
on the deployed bytecode. Verify constructor args round-trip by
reading `agentId()` + `identityRegistry()` from the contract.

---

## Step 6 — Verify on Basescan

```
EscrowFactory: https://sepolia.basescan.org/address/<EscrowFactory address>#code
Probe Escrow:  https://sepolia.basescan.org/address/<probe escrow address>#code
```

Optional: run `forge verify-contract` on both:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd contracts

  # Factory
  forge verify-contract \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
    --etherscan-api-key "$BASESCAN_API_KEY" \
    --chain base-sepolia \
    --constructor-args \
      $(cast abi-encode "constructor(address,address,address)" \
        0x036CbD53842c5426634e7929541eC2318f3dCF7e \
        0x8004A818BFB912233c491871b3d84c89A494BD9e \
        0x8004B663056A597Dffe9eCcC1965A193B7388713) \
    <EscrowFactory address> \
    src/EscrowFactory.sol:EscrowFactory
'
```

Verification of the per-agent Escrow itself is more involved (the
constructor args include dynamic arrays); skip unless the operator
specifically wants source on Basescan for the probe.

---

## Step 7 — Write deploy log + AGENTS.md update

(Claude Code does this after the operator reports steps 4–5 green.)

Create `contracts/deploy-logs/escrow-factory-base-sepolia-2026-05-02.md`
following the format of `splitter-factory-base-sepolia-2026-05-01.md`:

```
# EscrowFactory deploy — Base Sepolia — 2026-05-02

| EscrowFactory address | <addr>            |
| Deploy tx             | <tx>              |
| Block                 | <block>           |
| Gas used              | <gas>             |
| Deployer              | 0x66c285…b113c (KMS alias/reckon402/mainnet/deployer/evm) |
| Token (USDC)          | 0x036CbD…CF7e     |
| IdentityRegistry      | 0x8004A8…BD9e     |
| ReputationRegistry    | 0x8004B6…8713     |
| Probe Escrow address  | <addr>            |
| Probe Escrow agentId  | 1                 |
| Probe deploy tx       | <tx>              |
```

Append to `AGENTS.md` a new section `## L4d on-chain Escrow (v1, locked)`:

```
| Item | Value |
|------|-------|
| EscrowFactory (Base Sepolia) | <addr>     |
| Factory deploy tx            | <tx>       |
| Factory deploy block         | <block>    |
| Probe Escrow (agentId=1)     | <addr>     |
| Probe deploy tx              | <tx>       |
| Spec                         | specs/09-l4d-escrow.md |
| Deploy runbook               | tools/deploy/deploy-l4d.md |
| Tag                          | L4d-deployed |

Tier curve at deploy (passed by orchestrator + smoke-test probe):
  thresholds = [0, 1, 3, 10, 30, 100, 300, 1000]
  releaseBps = [0, 500, 1500, 3000, 5000, 7000, 8500, 10000]
  tags        = ("payment", "x402-settlement")
  facilitatorClient = 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455
```

Commit + tag:

```bash
git commit -am 'deploy(L4d): EscrowFactory live on Base Sepolia + probe Escrow smoke green'
git tag -a L4d-deployed \
  -m 'EscrowFactory + probe Escrow live on Base Sepolia.

Factory: <addr>  (tx <tx>, block <block>)
Probe:   <addr>  (agent 1, tier T<n> at <count> attestations)

Smoke results:
  - constructor reads (token/identity/reputation) match pinned addresses
  - probe Escrow returns owner = NFT holder (Basescan: <link>)
  - non-owner withdraw reverts NotOwner

E2 (orchestrator integration) and E3 (frontend wallet-claim) build on
this. Rollback baseline remains L4d-pre-onchain-baseline.'
git push --follow-tags
```

---

## Failure protocol

- **Step 0 preflight red:** funds the deployer per
  `tools/funding/seed-deployer.md`. Do NOT broadcast with < 0.02 ETH —
  the EscrowFactory deploy is ~0.0015 ETH and the probe Escrow is
  ~0.0015 ETH; you want headroom for retries.
- **Step 1 forge fail:** STOP. The fuzz/round-trip tests catch CREATE2
  prediction drift. Investigate `predictAddress` against
  `cast create2` golden vector before broadcasting.
- **Step 2 deploy fail:**
  - "insufficient funds": fund deployer.
  - "nonce too low": mempool race; wait 30s and retry.
  - "execution reverted": only happens if a constructor arg is the
    zero address. Re-check the env vars before the broadcast.
- **Step 2 sanity-read mismatch:** STOP. Factory was deployed with
  wrong args. Re-deploy with corrected env (no rollback needed —
  the wrong factory just sits there unused; do NOT record its
  address anywhere).
- **Step 3 createEscrow revert:** check `agentId` is registered in
  the IdentityRegistry already (`cast call IdentityRegistry "ownerOf(uint256)(address)" 1`).
  If not, the Escrow constructor's first `ownerOf` call would still
  succeed (constructor doesn't call it; only `withdraw` and `owner()`
  do) — so the revert is more likely a tier-array shape error.
- **Step 4 view returns unexpected zeros:** the registries on Base
  Sepolia might be on a different commit than AGENTS.md pins. Confirm
  via `cast call <ReputationRegistry> "getSummary(uint256,address[],string,string)"`
  with the same args directly; if it also returns 0, the chain has no
  matching feedback rows yet. Not a deploy bug — orchestrator will
  drive seller10 attestations in E4.
- **Step 5 non-owner withdraw succeeds:** CRITICAL. Roll back:
  - Do NOT record the EscrowFactory address anywhere in the repo.
  - Investigate the deployed bytecode against
    `forge inspect Escrow bytecode` from a fresh clone.
  - Most likely cause: solc version drift between the local build
    and Basescan-displayed build. Re-build with `forge clean &&
    forge build` and compare bytecode.
  - Reset to `L4d-pre-onchain-baseline` if the issue is non-trivial.

---

## Rollback

The factory itself is immutable on-chain — there is no "rollback" of
the deployed contract. Rollback at this layer means:

1. Do NOT proceed to E2 (orchestrator integration). Existing seller9
   onboarding flow continues to use the SplitterFactory only; the
   EscrowFactory exists silently with no consumers.
2. `git reset --hard L4d-pre-onchain-baseline` if the contract code
   itself needs to revert. The L4d-deployed factory will remain
   on-chain at its address but with no orchestrator pointing at it
   (and no AGENTS.md row referencing it), it's effectively dead
   weight that costs nothing.
3. If you've already proceeded to E2 and need to roll back: flip
   `ENABLE_L4D_ESCROW="false"` in the orchestrator's wrangler vars
   and redeploy. The orchestrator falls back to the L4c 5-step flow
   for new onboardings; existing seller9/seller10 are unaffected.

---

## References

- `specs/09-l4d-escrow.md` — spec.
- `contracts/src/Escrow.sol` — Escrow contract (~210 LOC).
- `contracts/src/EscrowFactory.sol` — factory (~150 LOC).
- `contracts/test/Escrow.t.sol` — 32-case test suite.
- `contracts/test/EscrowFactory.t.sol` — 14-case test suite incl. fuzz.
- `contracts/script/DeployEscrowFactory.s.sol` — deploy script.
- `tools/deploy/deploy-l4c-factory.md` — predecessor deploy runbook
  (this runbook's parent pattern; reuse Infisical conventions).

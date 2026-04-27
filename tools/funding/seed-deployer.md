# Seed the deployer with Sepolia ETH (operator action)

Operator-runnable recipe. Uses `cast send` (Foundry) so the funder
private key never leaves the operator's environment and never lands
on disk in this repo.

## What and why

| Chain | Need | Source | Amount | Reason |
|-------|------|--------|--------|--------|
| Base Sepolia (84532) | gas for L3 Splitter deploy + intra-project fan-out | `0x9AF7...3F04` (x402commit deployer, operator-controlled) | 0.05 ETH | One Splitter deploy is ~0.005 ETH; 0.05 covers ~10 redeploys + fund-fanouts |
| Ethereum Sepolia (11155111) | gas for ENS resolver record writes (`addr()`, optional CCIP-Read setup) | `0x9AF7...3F04` (same funder; carries 3.9 SepETH) | 0.05 ETH | Three `setAddr()` calls + a `setText()` clock-in around 0.001 ETH; 0.05 leaves ~50× headroom |

Pre-funding state confirmed in `results-pre-funding-2026-04-27.md`:
both source addresses are credited; the destination
(`0x66c2858d9a8605957c516a77262eb66ee6be113c`, the reckon402 KMS
deployer EOA) is empty on ETH on both Sepolias.

## Operator preconditions

- `cast` on PATH (Foundry — already pinned by the project: `forge`
  and `cast` from the same install).
- `X402COMMIT_FUNDER_PK` exported from operator's local secret
  store. The PK lives in `~/Projects/x402commit/facilitator/specs/.env.secrets`
  per the operator's records; it should NEVER be pasted into a
  reckon402 file or printed to a terminal output that gets logged.
- RPC URLs from this repo's Infisical (`infisical run -- env` exposes
  them). The `cast send` invocation reads RPCs from `--rpc-url`
  flags so we can pass the env values directly.

## Run (Base Sepolia)

```bash
unset AWS_PROFILE
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402

infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- \
  cast send \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
    --private-key "$X402COMMIT_FUNDER_PK" \
    --value 0.05ether \
    "$DEPLOYER_EOA"
```

Expected: a single transaction receipt with `status 1`. Save the
tx hash; it goes into the post-funding snapshot below.

## Run (Ethereum Sepolia)

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- \
  cast send \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" \
    --private-key "$X402COMMIT_FUNDER_PK" \
    --value 0.05ether \
    "$DEPLOYER_EOA"
```

## Verify

After both sends confirm, re-run the snapshot:

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- \
  node tools/funding/check-balances.mjs
```

Expected delta vs `results-pre-funding-2026-04-27.md`:

- `deployer (KMS)` on `base-sepolia`: 0 -> 0.05 ETH
- `deployer (KMS)` on `ethereum-sepolia`: 0 -> 0.05 ETH
- `x402commit-funder (external)` on `base-sepolia`: 3.5 -> ~3.45 ETH (minus 0.05 + gas)
- `x402commit-funder (external)` on `ethereum-sepolia`: 3.9 -> ~3.85 ETH

The post-funding snapshot is captured into
`results-post-funding-<date>.md` and committed as the verification
step that closes task C.

## Idempotency

`cast send` is not idempotent — re-running this recipe sends a
second 0.05 ETH on top. If the snapshot already shows the deployer
funded, do NOT re-run. The `check-balances.mjs` snapshot is the
authoritative "is it done?" check.

## Why no script

A `seed-deployer.mjs` that read `X402COMMIT_FUNDER_PK` from env
would work, but it would route a non-reckon402 secret through code
in this repo. Keeping the action as a documented `cast send`
invocation keeps the funder PK exclusively in the operator's
shell, the funder address explicitly in the operator's mind, and
the resulting tx fully reproducible from this single recipe file.

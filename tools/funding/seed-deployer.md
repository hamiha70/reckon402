# Seed the deployer with Sepolia ETH (operator action)

> **Status: COMPLETE for the 2026-04-27 round.** The deployer is at
> 1 ETH on each Sepolia. See `results-post-funding-2026-04-27.md`.
> This file is preserved as the **reproducible recipe** for the next
> top-up round.

Operator-runnable recipe. Uses `cast send` (Foundry) so the funder
private key never leaves the operator's environment and never lands
on disk in this repo.

## What and why

| Chain | Need | Source | Amount (this round) | Reason |
|-------|------|--------|---------------------|--------|
| Base Sepolia (84532) | gas for L3 Splitter deploy + intra-project fan-out | `0x9AF7...3F04` (x402commit funder, operator-controlled) | 1 ETH | ~10× headroom over a full L3 build (Splitter deploy + 7-EOA fan-out) at episodic-spike gas |
| Ethereum Sepolia (11155111) | gas for ENS resolver record writes (`addr()`, future CCIP-Read setup) | `0x9AF7...3F04` (same funder) | 1 ETH | ~50× headroom over a `setAddr()` + `setText()` flow at episodic-spike gas |

The 1 ETH per chain figure was operator-set on 2026-04-27 (was
originally 0.05 ETH per chain in the spec lock; bumped to 1 to
match operator preference for a single, well-headroomed round).
The corresponding L0 floor in `funded.sh` stays at 0.01 ETH —
"healthy threshold," not "topped up threshold," see spec §9.

## Operator preconditions

- `cast` on PATH (Foundry — already pinned by the project: `forge`
  and `cast` from the same install).
- `X402COMMIT_FUNDER_PK` exported from operator's local secret
  store. The PK lives in `~/Projects/x402commit/facilitator/specs/.env.secrets`
  (gitignored, operator-controlled). It must NEVER be pasted into
  a reckon402 file or printed to a terminal output that gets
  logged.
- RPC URLs and the destination address come from this repo's
  Infisical project (`reckon402 / dev`). They are NOT in the
  operator's outer shell — see "Shell-quoting trap" below.

## Shell-quoting trap (read before running)

`infisical run -- cast send --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" ...`
**does not work** because `$BASE_SEPOLIA_RPC_PRIMARY` and
`$DEPLOYER_EOA` only exist inside the child process that
`infisical run` spawns. The outer shell expands them to empty
*before* `infisical run` is even invoked, and `cast send` then
fails with `error: invalid value '' for '[TO]': invalid string length`.

The fix is to defer expansion until inside the infisical subshell
by wrapping in `bash -c '...'` with **single quotes**:

```bash
infisical run … -- bash -c '
  cast send \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
    ...
'
```

Single quotes keep `$BASE_SEPOLIA_RPC_PRIMARY` literal in the
outer shell. `bash -c` then evaluates them after infisical has
injected the env. `$X402COMMIT_FUNDER_PK` still passes through
because it was `export`ed in the outer shell, which `infisical
run`'s child process inherits.

## Stage the funder PK (outer shell)

```bash
unset AWS_PROFILE
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402

export X402COMMIT_FUNDER_PK="$(awk -F'=' '/^DEPLOYER_PRIVATE_KEY=/ {
  sub(/^DEPLOYER_PRIVATE_KEY=/, ""); gsub(/["'"'"']/, ""); print; exit
}' ~/Projects/x402commit/facilitator/specs/.env.secrets)"

# Sanity check (length + prefix only — never echo the PK itself).
[[ -n "$X402COMMIT_FUNDER_PK" ]] \
  && echo "PK loaded ($(echo -n $X402COMMIT_FUNDER_PK | wc -c) chars), prefix=${X402COMMIT_FUNDER_PK:0:4}*****"
```

## Run (Base Sepolia)

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- bash -c '
    cast send \
      --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
      --private-key "$X402COMMIT_FUNDER_PK" \
      --value 1ether \
      "$DEPLOYER_EOA"
  '
```

Expected: a single transaction receipt with `status 1`, gasUsed
21000. Save the tx hash; it goes into the post-funding snapshot.

## Run (Ethereum Sepolia)

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- bash -c '
    cast send \
      --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" \
      --private-key "$X402COMMIT_FUNDER_PK" \
      --value 1ether \
      "$DEPLOYER_EOA"
  '
```

## Tear down PK from outer shell

```bash
unset X402COMMIT_FUNDER_PK
```

## Verify

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- node tools/funding/check-balances.mjs
```

…then run the L0 funded probe:

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- ./tools/smoke-tests/funded.sh
```

Expected: `PASS funded …ms base-sep=<X>eth eth-sep=<Y>eth floor=0.01eth deployer=0x66c2…113c`.

## Round 1 actual delta (2026-04-27)

Captured in `results-post-funding-2026-04-27.md`:

- `deployer (KMS)` on `base-sepolia`: 0 → 1 ETH
- `deployer (KMS)` on `ethereum-sepolia`: 0 → 1 ETH
- `x402commit-funder` on `base-sepolia`: 3.5 → 2.5 ETH (1 ETH plus ~0.0001 ETH gas)
- `x402commit-funder` on `ethereum-sepolia`: 3.9 → 2.9 ETH (1 ETH plus ~0.0001 ETH gas)

Tx hashes:
- Base Sepolia: `0x59539921c505cd94eaca89b68bed031d37f73903baa16e82b870af9abb794c6f`
- Ethereum Sepolia: `0x8de4851047b6304eb79c7b65a46c06b182e15b4c256ede67c56e84b056338d31`

USDC balances unchanged on every row.

## Idempotency

`cast send` is not idempotent — re-running this recipe sends a
second 1 ETH on top. If `funded.sh` already PASSes well above
the floor, do NOT re-run. The `check-balances.mjs` snapshot is
the authoritative "is it done?" check; `funded.sh` is the
red/green health gate that triggers if a top-up is actually
needed.

## Why no script

A `seed-deployer.mjs` that read `X402COMMIT_FUNDER_PK` from env
would work, but it would route a non-reckon402 secret through
code in this repo. Keeping the action as a documented `cast send`
invocation keeps the funder PK exclusively in the operator's
shell, the funder address explicitly in the operator's mind, and
the resulting tx fully reproducible from this single recipe file.

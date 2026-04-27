# Deploy Splitter (Base Sepolia)

Operator runbook. Run exactly once per deploy. Records deploy log under
`contracts/deploy-logs/splitter-base-sepolia-<date>.md`, records deployed
address + tx hash + gas used. The deployed address is then recorded under
AGENTS.md "## L3 deployments (v1, locked)" in the same commit as the
integration test (commit 6).

## Pre-conditions

1. Deployer EOA `0x66C2858D9A8605957c516a77262Eb66EE6be113C` funded ≥ 0.01 ETH
   on Base Sepolia. Verify via L0 `funded.sh`. Top up via `tools/funding/`
   if red.
2. KMS deployer IAM credentials (`reckon402-deployer`) available in Infisical
   as `DEPLOYER_AWS_ACCESS_KEY_ID` / `DEPLOYER_AWS_SECRET_ACCESS_KEY`.
3. Contracts compiled: `cd contracts && forge build`.

## Command

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$DEPLOYER_AWS_SECRET_ACCESS_KEY"
  export AWS_REGION="eu-central-1"
  unset AWS_PROFILE
  node tools/deploy/deploy-splitter.mjs
'
```

Stdout is the deployed Splitter address (so `$(node tools/deploy/...)` can
capture it). Stderr is the deploy log.

## Post-conditions

- `contracts/deploy-logs/splitter-base-sepolia-<date>.md` exists.
- `https://sepolia.basescan.org/address/<ADDRESS>` shows code + the
  `Deployed(...)` event.
- `wrangler.toml` for `workers/facilitator/` and `workers/agent/` both set
  `SPLITTER_ADDRESS = "<ADDRESS>"`.

## Basescan verification (manual, after deploy)

```bash
cd contracts
forge verify-contract \
  --chain base-sepolia \
  --num-of-optimizations 200 \
  --watch \
  --constructor-args "$(cast abi-encode 'constructor(address,address[],uint16[])' \
      0x036CbD53842c5426634e7929541eC2318f3dCF7e \
      '[0xD53ffac42496d73B3Faf946786688a8454F57b1f,0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455,0x66C2858D9A8605957c516a77262Eb66EE6be113C]' \
      '[9700,200,100]')" \
  --etherscan-api-key "$BASESCAN_API_KEY" \
  <SPLITTER_ADDRESS> \
  src/Splitter.sol:Splitter
```

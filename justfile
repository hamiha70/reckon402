set dotenv-load := false

secrets := "tools/with-secrets.sh"

# Print a human-readable summary of key recipes
help:
    @echo "Reckon402 — key recipes:"
    @echo ""
    @echo "  Pre-submission gates (no on-chain spend):"
    @echo "    just preflight-submission Run all idempotent gates: vitest + forge + typecheck + healthz-all + fork-tests-all"
    @echo "    just healthz-all          Probe /healthz on every worker + cast-call every L4d contract"
    @echo "    just fork-tests-all       Run L3 + L4d Foundry fork tests vs live Base Sepolia"
    @echo ""
    @echo "  Live integration smokes (REAL gas + USDC, mutates on-chain state):"
    @echo "    just fullflow-l4b         Live settle + ERC-8004 attestation roundtrip (alias: test-e2e)"
    @echo "    just fullflow-l3          Live L3 settle roundtrip (alias: test-payment)"
    @echo "    just fullflow-l4c-onboard 6-step L4d onboard against live Sepolia (alias: test-onboard)"
    @echo ""
    @echo "  Onboarding + ops:"
    @echo "    just onboard <ens> <eoa>    Onboard a new SellingAgent (5 steps)"
    @echo "    just balance                Check EOA balances"
    @echo "    just tail-facilitator       Stream facilitator worker logs"
    @echo "    just tail-agent             Stream agent worker logs"
    @echo ""
    @echo "  Deploys (per-Worker):"
    @echo "    just deploy-landing         Deploy reckon402.com landing Worker"
    @echo "    just deploy-agent           Deploy agent.reckon402.com Worker"
    @echo "    just deploy-facilitator     Deploy facilitator.reckon402.com Worker"
    @echo "    just deploy-gateway         Deploy gateway.reckon402.com Worker (production)"
    @echo "    just deploy-gateway-staging Deploy gateway-staging.reckon402.com Worker"
    @echo "    just deploy-orchestrator    Deploy app.reckon402.com Worker (frontend assets bundled)"
    @echo "    just deploy-all             Deploy all six production Workers in sequence"

# Show available recipes
default:
    @just --list

# Run L3 deploy preflight (KMS sign probe + balance probes + RPC reachability)
preflight-l3:
    {{secrets}} bash tools/scripts/preflight-l3.sh

# Show ETH + USDC balances for all reckon402 EOAs on Base Sepolia and Ethereum Sepolia
balance:
    {{secrets}} node tools/funding/check-balances.mjs

# Stream live logs from the facilitator Worker (wrangler tail)
tail-facilitator:
    {{secrets}} bash -c 'cd workers/facilitator && pnpm exec wrangler tail reckon402-facilitator --format pretty'

# Stream live logs from the agent Worker (wrangler tail)
tail-agent:
    {{secrets}} bash -c 'cd workers/agent && pnpm exec wrangler tail reckon402-agent --format pretty'

# Run the live end-to-end L3 integration test on Base Sepolia
fullflow-l3:
    {{secrets}} bash -c 'cd tools/integration-tests && bash full-flow-l3.sh'

# Run the replay-protection demo on Base Sepolia (run fullflow-l3 first)
replay-l3:
    {{secrets}} bash -c 'cd tools/integration-tests && bash replay-l3.sh'

# Run the L4b1 full-flow smoke — live settlement + ERC-8004 attestation + gateway cache-invalidate.
# Exits 0 when the settle path is green AND the attestation tx lands AND the
# subsequent reputation read reflects the new count.
fullflow-l4b:
    {{secrets}} bash -c 'cd tools/integration-tests && bash full-flow-l4b.sh'

# Seed an EOA with ETH on Base Sepolia. Usage: just seed <kind> <amount>
# kind: deployer | facilitator    amount: e.g. 0.1
seed kind amount:
    {{secrets}} bash tools/scripts/seed.sh {{kind}} {{amount}}

# Return ETH from a reckon402 EOA to the funder. Usage: just refund <kind> <amount>
# kind: deployer | facilitator    amount: e.g. 0.1
refund kind amount:
    {{secrets}} bash tools/scripts/refund.sh {{kind}} {{amount}}

# L4c — deploy a factory Splitter for an existing SellingAgent and print the UPDATE SQL
# for the gateway D1 record. Usage: just seed-factory-splitter <ensName> <sellerEoa>
seed-factory-splitter ensName sellerEoa:
    {{secrets}} node tools/deploy/seed-factory-splitter.mjs {{ensName}} {{sellerEoa}}

# L4c — deploy the SplitterFactory contract to Base Sepolia (KMS-signed).
# Writes deploy log to contracts/deploy-logs/splitter-factory-base-sepolia-<date>.md
# and prints the factory address on stdout.
deploy-splitter-factory:
    {{secrets}} node tools/deploy/deploy-splitter-factory.mjs

# L4c — run the full-flow factory smoke (happy path + forged-splitter negative).
fullflow-l4c-factory:
    {{secrets}} bash -c 'cd tools/integration-tests && bash full-flow-l4c-factory.sh'

# L4c — onboard a fresh SellingAgent via the 5-step CLI. Runs ENS subname mint,
# Splitter deploy, ERC-8004 agentId register, gateway record write, gateway
# seed, and final ENS ownership transfer to the seller EOA.
#
# Usage: just onboard <ensName> <sellerEoa> [endpoint] [amount]
#   ensName:   e.g. seller9.reckon402-test.eth
#   sellerEoa: the SellingAgent's EOA on Base Sepolia (also becomes Splitter recipient[0])
#   endpoint:  defaults to https://agent.reckon402.com/research
#   amount:    atomic USDC, defaults to 100000 (0.10 USDC)
onboard ensName sellerEoa endpoint='https://agent.reckon402.com/research' amount='100000':
    {{secrets}} pnpm -C tools/onboard exec tsx src/cli.ts \
      --name {{ensName}} \
      --seller-eoa {{sellerEoa}} \
      --endpoint {{endpoint}} \
      --amount {{amount}}

# L4d — onboard a fresh SellingAgent via the 6-step CLI with a per-agent
# on-chain Escrow. ENS mint -> ERC-8004 agentId -> Escrow deploy -> 3-recipient
# Splitter (seller / facilitator-fee / Escrow) -> ENS records (incl. x402.escrow)
# -> gateway seed + ENS ownership transfer.
#
# Requires Infisical secrets: ESCROW_FACTORY_ADDRESS, TIER_STRATEGY_ADDRESS,
# FACILITATOR_FEE_EOA — pinned to the L4d-strategy-deployed canonical addresses.
#
# Usage: just onboard-l4d <ensName> <sellerEoa> [endpoint] [amount]
onboard-l4d ensName sellerEoa endpoint='https://agent.reckon402.com/research' amount='100000':
    {{secrets}} pnpm -C tools/onboard exec tsx src/cli.ts \
      --name {{ensName}} \
      --seller-eoa {{sellerEoa}} \
      --endpoint {{endpoint}} \
      --amount {{amount}} \
      --enable-l4d-escrow

# L4c — live full-flow onboard + paid-call smoke. Assumes 08A factory deployed
# and 08B orchestrator + gateway admin routes live.
fullflow-l4c-onboard:
    {{secrets}} bash tools/integration-tests/run-l4c-onboard.sh

# Run the L4d Escrow fork tests against live Base Sepolia. Forks the chain
# at the latest block, registers a fresh ERC-8004 agentId on the real
# IdentityRegistry, deploys factory + tier strategy + per-agent Escrow,
# distributes USDC, walks tiers via real giveFeedback() calls, and
# withdraws as the NFT owner. Also runs read-only sanity assertions on
# the live seller11 Escrow + EscrowFactory immutables.
#
# Default `forge test` does NOT exercise these (gated on L4D_FORK_TEST=1)
# so offline runs stay green and fast.
fork-test-l4d:
    {{secrets}} bash -c 'cd contracts && L4D_FORK_TEST=1 forge test --fork-url "$BASE_SEPOLIA_RPC_PRIMARY" --match-contract EscrowForkTest -vv'

# Run the L3 Splitter fork test against live Base Sepolia. Forks the chain,
# signs an EIP-3009 transferWithAuthorization for a freshly-deployed
# Splitter, broadcasts it via the real USDC contract on the fork, then
# distributes and asserts the BPS-correct deltas. Same gating pattern as
# fork-test-l4d above.
fork-test-l3:
    {{secrets}} bash -c 'cd contracts && SPLITTER_FORK_TEST=1 forge test --fork-url "$BASE_SEPOLIA_RPC_PRIMARY" --match-contract SplitterForkTest -vv'

# Run BOTH fork suites in sequence. Useful as a pre-submission gate to
# prove the contracts integrate end-to-end with live registries.
fork-tests-all: fork-test-l3 fork-test-l4d

# Pre-submission unified health probe. Hits /healthz on every Reckon402
# Cloudflare Worker + AWS Lambda, then `cast call`s every L4d on-chain
# contract on Base Sepolia (EscrowFactory, TierStrategy, SplitterFactory,
# seller11 Splitter + Escrow) and the Reckon402Resolver on Ethereum
# Sepolia. Exits 0 ONLY if every probe is green.
healthz-all:
    {{secrets}} bash tools/integration-tests/healthz-all.sh

# Run EVERY idempotent pre-submission gate. Safe to run repeatedly —
# nothing here writes on-chain state or burns gas. Order is hot-to-
# cold (fastest gate first) so a regression surfaces early:
#
#   1. pnpm test         — 362 vitest cases, full TS workspace (~15s)
#   2. forge test        — 109 Foundry cases, offline (~10s)
#   3. pnpm typecheck    — frontend // @ts-check (~3s)
#   4. just healthz-all  — 15 live HTTP + cast call probes (~5s)
#   5. just fork-tests-all — L3 + L4d Foundry fork tests against live
#                            Base Sepolia (~60s)
#
# What this DOES NOT include (intentional — these mutate on-chain
# state and cost gas; running them must stay an explicit operator
# decision):
#   - just fullflow-l4b           (settles + writes attestation)
#   - just fullflow-l4c-onboard   (mints ENS + ERC-8004 agentId)
#   - just fullflow-l4c-factory   (settles a payment)
#   - just fullflow-l3            (settles a payment)
#
# A failure in any step exits non-zero and skips the rest. The full
# pre-submission protocol is documented in docs/test-posture-h-9.md §9.
preflight-submission:
    @echo "==> [1/5] pnpm test (vitest workspace)"
    pnpm test
    @echo "==> [2/5] forge test (offline Foundry suite)"
    cd contracts && forge test
    @echo "==> [3/5] pnpm typecheck (frontend // @ts-check)"
    pnpm typecheck
    @echo "==> [4/5] healthz-all (live HTTP + on-chain reads)"
    just healthz-all
    @echo "==> [5/5] fork-tests-all (Foundry vs live Base Sepolia)"
    just fork-tests-all
    @echo ""
    @echo "==> preflight-submission: GREEN. Mutating gates (fullflow-l4b etc.) NOT run — call manually."

# Deploy reckon402.com landing Worker (no package.json — uses npx)
deploy-landing:
    {{secrets}} bash -c 'cd workers/landing && npx wrangler deploy'

# Deploy demo.reckon402.com static dashboard (CF Pages).
# KNOWN RISK: the CF API token may lack Pages:Edit scope; if this fails with a
# permissions error follow demo/DEPLOY.md for the manual one-time setup.
deploy-demo:
    {{secrets}} bash -c 'npx wrangler pages deploy demo/ --project-name reckon402-demo'

# Deploy agent.reckon402.com Worker
deploy-agent:
    {{secrets}} bash -c 'cd workers/agent && pnpm run deploy'

# Deploy facilitator.reckon402.com Worker
deploy-facilitator:
    {{secrets}} bash -c 'cd workers/facilitator && pnpm run deploy'

# Notes on gateway deploys: production and staging are separate recipes
# because staging deploy is an explicit operator action (it re-warms caches
# and may flush in-flight CCIP-Read responses), not a side-effect of
# `just deploy-all`.

# Deploy gateway.reckon402.com Worker (production env)
deploy-gateway:
    {{secrets}} bash -c 'cd gateway && pnpm run deploy'

# Deploy gateway-staging.reckon402.com Worker (staging env)
deploy-gateway-staging:
    {{secrets}} bash -c 'cd gateway && pnpm run deploy:staging'

# Note on app.reckon402.com: there is NO separate `deploy-frontend` recipe.
# apps/frontend has no standalone Worker — its dist/ is bundled as Workers
# Assets into the onboard-orchestrator Worker, so all UI changes ship via
# `just deploy-orchestrator`. apps/frontend/wrangler.jsonc is vestigial.

# Deploy app.reckon402.com Worker (orchestrator + bundled frontend assets)
deploy-orchestrator:
    {{secrets}} bash -c 'cd workers/onboard-orchestrator && pnpm run deploy'

# Notes on deploy-all order: read-side (landing, gateway) first; write-side
# (agent, facilitator, orchestrator) last. Minimises the window where an
# in-flight buyer call could hit a stale downstream during a multi-worker
# rollout.

# Deploy all six production Workers in sequence (landing, gateway, agent, facilitator, orchestrator)
deploy-all: deploy-landing deploy-gateway deploy-agent deploy-facilitator deploy-orchestrator

# Readable aliases
test-e2e: fullflow-l4b
test-payment: fullflow-l3
test-onboard: fullflow-l4c-onboard

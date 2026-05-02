set dotenv-load := false

secrets := "tools/with-secrets.sh"

# Print a human-readable summary of key recipes
help:
    @echo "Reckon402 — key recipes:"
    @echo "  just test-e2e               Run full end-to-end test (payment + attestation)"
    @echo "  just test-payment           Run L3 payment settlement test only"
    @echo "  just onboard <ens> <eoa>    Onboard a new SellingAgent (5 steps)"
    @echo "  just balance                Check EOA balances"
    @echo "  just tail-facilitator       Stream facilitator worker logs"
    @echo "  just tail-agent             Stream agent worker logs"
    @echo "  just deploy-landing         Deploy reckon402.com landing Worker"
    @echo "  just deploy-agent           Deploy agent.reckon402.com Worker"
    @echo "  just deploy-facilitator     Deploy facilitator.reckon402.com Worker"
    @echo "  just deploy-gateway         Deploy gateway.reckon402.com Worker (production)"
    @echo "  just deploy-gateway-staging Deploy gateway-staging.reckon402.com Worker"
    @echo "  just deploy-orchestrator    Deploy app.reckon402.com Worker (bundles apps/frontend/dist as assets)"
    @echo "  just deploy-all             Deploy all six production Workers in sequence"

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

# L4c — live full-flow onboard + paid-call smoke. Assumes 08A factory deployed
# and 08B orchestrator + gateway admin routes live.
fullflow-l4c-onboard:
    {{secrets}} bash tools/integration-tests/run-l4c-onboard.sh

# Deploy reckon402.com landing Worker (no package.json — uses npx)
deploy-landing:
    {{secrets}} bash -c 'cd workers/landing && npx wrangler deploy'

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

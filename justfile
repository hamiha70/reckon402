set dotenv-load := false

secrets := "tools/with-secrets.sh"

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
    {{secrets}} bash -c 'wrangler tail reckon402-facilitator-prod --format pretty'

# Stream live logs from the agent Worker (wrangler tail)
tail-agent:
    {{secrets}} bash -c 'wrangler tail reckon402-agent-prod --format pretty'

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
    {{secrets}} bash -c 'cd tools/integration-tests && bash full-flow-l4c-onboard.sh'

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

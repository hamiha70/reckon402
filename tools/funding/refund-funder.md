# Refund ETH to the funder EOA (operator action)

Operator-runnable recipe. Mirrors `seed-deployer.md` in reverse: sends ETH
from a reckon402-controlled EOA (deployer or facilitator) back to the
`x402commit-funder` EOA. Use when an EOA has excess ETH after L3/L4 activity
and the funder needs its balance restored.

## What and why

| Source | Direction | Destination |
|--------|-----------|-------------|
| Deployer (`DEPLOYER_EOA`) | → | `X402COMMIT_FUNDER_ADDRESS` |
| Facilitator (`FACILITATOR_ADDRESS`) | → | `X402COMMIT_FUNDER_ADDRESS` |

Both paths use `cast send` with the EOA's software private key (hydrated
from Infisical). The deployer key (`DEPLOYER_PK`) and facilitator key
(`FACILITATOR_PK`) are stored in Infisical `reckon402/dev`.

**Amount rule**: send in 0.1 ETH increments, leaving at least 0.05 ETH
in the source EOA for gas headroom. Do not drain below the L0 `funded.sh`
floor (0.01 ETH on the deployer).

## Operator preconditions

- `cast` on PATH (Foundry).
- Infisical CLI authenticated against `https://secrets.intentralabs.com`
  with read access to project `reckon402 / dev`.
- The secrets `DEPLOYER_PK`, `FACILITATOR_PK`, `X402COMMIT_FUNDER_ADDRESS`,
  and `BASE_SEPOLIA_RPC_PRIMARY` must all be present in Infisical.

## Run

```bash
# Return 0.1 ETH from the deployer to the funder:
just refund deployer 0.1

# Return 0.1 ETH from the facilitator EOA to the funder:
just refund facilitator 0.1
```

`just refund` wraps `tools/with-secrets.sh` → `tools/scripts/refund.sh`.
The private key is never written to disk; it exists only in the
Infisical-injected child process.

## Verify

```bash
just balance
```

Expected: source EOA balance decreased by ~`<amount>` ETH (plus ~0.00005 ETH
gas), funder EOA balance increased by ~`<amount>` ETH.

## Shell-quoting note

`just refund <kind> <amount>` single-quotes the argument values when
forwarding to the shell script so they are not expanded in the outer
shell. The script itself receives literal strings.

## Idempotency

`cast send` is not idempotent — re-running sends another transfer. Check
`just balance` before running to confirm the current balances, and verify
the tx receipt after each run.

# tools/provisioning

One-shot ops scripts for reckon402 on-chain identity provisioning.
All scripts are **idempotent**: re-running never clobbers existing
state.

Implementation contract: `specs/01-eoa-topology.md`.

## provision-eoas.mjs

Generates the five reckon402 **software** EOAs (facilitator, seller,
buyer-demo ×3) and pushes their private keys + addresses to Infisical
(self-hosted, project `reckon402`, env `dev`).

The two **KMS-backed** EOAs (deployer, buyer-signer) are NOT in scope
here — they are provisioned separately via the AWS CLI and have their
metadata in Infisical already.

```bash
# from repo root, with direnv (or manually exporting INFISICAL_*):
pnpm -C tools/provisioning eoas
```

The script:

1. For each role in `[FACILITATOR, SELLER, BUYER_DEMO_1, BUYER_DEMO_2, BUYER_DEMO_3]`:
   - Reads `{ROLE}_PK` and `{ROLE}_ADDRESS` from Infisical.
   - If both already set → SKIP.
   - If one present but not the other → ABORT (half-state refusal).
   - Otherwise → generate a fresh secp256k1 keypair via `viem`,
     push both keys to Infisical, verify via round-trip read.
2. Prints a summary table of role / action / address. Private keys
   are NEVER printed.

Output is safe to commit to a verification log.

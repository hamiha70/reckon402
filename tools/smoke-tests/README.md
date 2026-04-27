# tools/smoke-tests/

L0 infra + sponsor-tech smoke tests. Populated in the L0 commit batch.

Run all probes:

```
./run-all.sh
```

Individual probes (each script exits 0 on green, 2 on intentional
SKIP, non-zero on FAIL):

- `infisical.sh` — Hydration layer reachability + sentinel round-trip
- `cf.sh` — Cloudflare account, DNS, Wrangler dry-run
- `aws.sh` — AWS STS + KMS sign-and-recover round-trip
- `rpc.sh` — Base + Ethereum, mainnet + Sepolia, primary + fallback (8 endpoints)
- `ens.sh` — Sepolia ENS `addr()` resolution against the L0 test name
- `erc8004.sh` — Reputation read on Base mainnet
- `kh.sh` — KeeperHub CLI auth + `kh doctor` reachability
- `d1.sh` — D1 create + insert + select latency
- `funded.sh` — Deployer ETH ≥ 0.01 ETH floor on each Sepolia

Implementation contract: `specs/00-l0-smoke-tests.md`.
Outcomes are written to `results-<DATE>.md` and committed.

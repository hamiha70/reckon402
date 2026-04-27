# tools/smoke-tests/

L0 infra + sponsor-tech smoke tests. Populated in the L0 commit batch.

Run all probes:

```
./run-all.sh
```

Individual probes (each script exits 0 on green, non-zero on red):

- `cf.sh` — Cloudflare account, DNS, Wrangler dry-run
- `aws.sh` — AWS STS + KMS sign-and-recover round-trip
- `rpc.sh` — Base mainnet + Sepolia two-endpoint redundancy
- `ens.sh` — CCIP-Read end-to-end against a Sepolia stub
- `erc8004.sh` — Reputation read on Base mainnet
- `kh.sh` — KeeperHub stub-agent webhook callback
- `d1.sh` — D1 create + insert + select latency

Outcomes are written to `results-<DATE>.md` and committed.

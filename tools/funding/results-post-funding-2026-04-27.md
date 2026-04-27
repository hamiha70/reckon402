# reckon402 — balance snapshot 2026-04-27T12:20:35Z (post-funding)

Source: `tools/funding/check-balances.mjs`. Address inputs from Infisical (`reckon402 / dev`); RPC inputs from Infisical (`*_RPC_PRIMARY`, falls back to `*_RPC_FALLBACK`).

## Funding events captured here

Two `cast send` transfers from x402commit-funder (`0x9AF7...3F04`)
to reckon402 deployer (`0x66c2...113c`), authorized by operator
2026-04-27 ~14:20 CET.

| Chain | Amount | Tx hash | Block | gasUsed |
|-------|--------|---------|-------|---------|
| Base Sepolia (84532) | 1 ETH | [`0x59539921…794c6f`](https://sepolia.basescan.org/tx/0x59539921c505cd94eaca89b68bed031d37f73903baa16e82b870af9abb794c6f) | 40762066 | 21 000 |
| Ethereum Sepolia (11155111) | 1 ETH | [`0x8de48510…6338d31`](https://sepolia.etherscan.io/tx/0x8de4851047b6304eb79c7b65a46c06b182e15b4c256ede67c56e84b056338d31) | 10742544 | 21 000 |

Both `status 1 (success)`. Funder PK was loaded from the
operator-controlled `~/Projects/x402commit/facilitator/specs/.env.secrets`
into the cast-send subshell only, scoped via `export ... && unset`
in the same shell sequence so it never persists in the parent
environment.

## Delta vs `results-pre-funding-2026-04-27.md`

| Address | Chain | ETH before | ETH after | Δ |
|---------|-------|------------|-----------|---|
| deployer (`0x66c2...113c`) | base-sepolia | 0 | 1 | +1 |
| deployer (`0x66c2...113c`) | ethereum-sepolia | 0 | 1 | +1 |
| funder (`0x9AF7...3F04`) | base-sepolia | 3.5 | 2.5 | −1 (plus ~0.0001 gas) |
| funder (`0x9AF7...3F04`) | ethereum-sepolia | 3.9 | 2.9 | −1 (plus ~0.0001 gas) |

USDC balances unchanged on every row. The funder retains 2.5 BSep ETH
and 2.9 SepETH liquidity for follow-on fan-out funding if needed
without operator refill.

## Snapshot

### base-mainnet (chainId 8453)

RPC: `BASE_MAINNET_RPC_PRIMARY`

| Role | Address | ETH | USDC |
|------|---------|-----|------|
| deployer (KMS) | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | 0 | 0 |
| buyer-signer (KMS) | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` | 0 | 0 |
| facilitator | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` | 0 | 0 |
| seller | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` | 0 | 0 |
| buyer-demo-1 | `0x837e30740a4A5bAC5480b4f707924469d42b43De` | 0 | 0 |
| buyer-demo-2 | `0xa5B79dCC1ec00730dcE031B803AF9A563B50A186` | 0 | 0 |
| buyer-demo-3 | `0x3529C5fe5Dcb1C1E0Bc8a393dF75EB88CF23E1e1` | 0 | 0 |
| kh-workflow (external) | `0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4` | 0 | 0 |
| x402commit-funder (external) | `0x9AF7467EA3663F6E9cCdD4bC73bC31f537BF3F04` | 0 | 0 |

### base-sepolia (chainId 84532)

RPC: `BASE_SEPOLIA_RPC_PRIMARY`

| Role | Address | ETH | USDC |
|------|---------|-----|------|
| deployer (KMS) | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | 1 | 20 |
| buyer-signer (KMS) | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` | 0 | 20 |
| facilitator | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` | 0 | 20 |
| seller | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` | 0 | 20 |
| buyer-demo-1 | `0x837e30740a4A5bAC5480b4f707924469d42b43De` | 0 | 20 |
| buyer-demo-2 | `0xa5B79dCC1ec00730dcE031B803AF9A563B50A186` | 0 | 20 |
| buyer-demo-3 | `0x3529C5fe5Dcb1C1E0Bc8a393dF75EB88CF23E1e1` | 0 | 20 |
| kh-workflow (external) | `0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4` | 0 | 0 |
| x402commit-funder (external) | `0x9AF7467EA3663F6E9cCdD4bC73bC31f537BF3F04` | 2.5 | 30 |

### ethereum-mainnet (chainId 1)

RPC: `ETH_MAINNET_RPC_PRIMARY`

| Role | Address | ETH | USDC |
|------|---------|-----|------|
| deployer (KMS) | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | 0 | 0 |
| buyer-signer (KMS) | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` | 0 | 0 |
| facilitator | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` | 0 | 0 |
| seller | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` | 0 | 0 |
| buyer-demo-1 | `0x837e30740a4A5bAC5480b4f707924469d42b43De` | 0 | 0 |
| buyer-demo-2 | `0xa5B79dCC1ec00730dcE031B803AF9A563B50A186` | 0 | 0 |
| buyer-demo-3 | `0x3529C5fe5Dcb1C1E0Bc8a393dF75EB88CF23E1e1` | 0 | 0 |
| kh-workflow (external) | `0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4` | 0 | 0 |
| x402commit-funder (external) | `0x9AF7467EA3663F6E9cCdD4bC73bC31f537BF3F04` | 0 | 0 |

### ethereum-sepolia (chainId 11155111)

RPC: `ETH_SEPOLIA_RPC_PRIMARY`

| Role | Address | ETH | USDC |
|------|---------|-----|------|
| deployer (KMS) | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | 1 | 20 |
| buyer-signer (KMS) | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` | 0 | 0 |
| facilitator | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` | 0 | 0 |
| seller | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` | 0 | 0 |
| buyer-demo-1 | `0x837e30740a4A5bAC5480b4f707924469d42b43De` | 0 | 0 |
| buyer-demo-2 | `0xa5B79dCC1ec00730dcE031B803AF9A563B50A186` | 0 | 0 |
| buyer-demo-3 | `0x3529C5fe5Dcb1C1E0Bc8a393dF75EB88CF23E1e1` | 0 | 0 |
| kh-workflow (external) | `0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4` | 0 | 0 |
| x402commit-funder (external) | `0x9AF7467EA3663F6E9cCdD4bC73bC31f537BF3F04` | 2.9 | 100 |

---
snapshot 1794ms · base-mainnet deployer=0eth/0usdc · base-sepolia deployer=1eth/20usdc · ethereum-mainnet deployer=0eth/0usdc · ethereum-sepolia deployer=1eth/20usdc

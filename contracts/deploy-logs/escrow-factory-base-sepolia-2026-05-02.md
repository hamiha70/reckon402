# EscrowFactory + LinearMonotonicTierStrategy deploy — Base Sepolia — 2026-05-02

## EscrowFactory

| Field | Value |
|-------|-------|
| EscrowFactory address | `0xb06998682bd716e0864257b3ac3aa1fc4cc64589` |
| Deploy tx | `0x248161a136d997dd82fa184bdceac5cb4c512ac2d253d9a70735d9170b692318` |
| Block | 40971225 |
| Gas used | 1750822 |
| Deployer | `0x66c2858d9a8605957c516a77262eb66ee6be113c` (KMS `alias/reckon402/mainnet/deployer/evm`) |
| Token (USDC) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Basescan | https://sepolia.basescan.org/address/0xb06998682bd716e0864257b3ac3aa1fc4cc64589 |
| Basescan tx | https://sepolia.basescan.org/tx/0x248161a136d997dd82fa184bdceac5cb4c512ac2d253d9a70735d9170b692318 |

## LinearMonotonicTierStrategy (v1 default)

| Field | Value |
|-------|-------|
| Strategy address | `0xc498155bc4a2e4ba979ad5797298107c63b26c4e` |
| Deploy tx | `0x43292eb658e3f062c6d59f44991775012b8d3349d9477b96db575414af8526fb` |
| Block | 40971225 |
| Gas used | 601592 |
| Tier thresholds | ["0","1","3","10","30","100","300","1000"] |
| Tier releaseBps | [0,500,1500,3000,5000,7000,8500,10000] |
| Basescan | https://sepolia.basescan.org/address/0xc498155bc4a2e4ba979ad5797298107c63b26c4e |
| Basescan tx | https://sepolia.basescan.org/tx/0x43292eb658e3f062c6d59f44991775012b8d3349d9477b96db575414af8526fb |

## Probe Escrow (agentId=1, seller.reckon402-test.eth)

| Field | Value |
|-------|-------|
| Probe Escrow address | `0xEa8BEd2bEE679276F78DeCa49eE8B531f0ADaF78` |
| Deploy tx | `0x280deaaa61df32f32a71c23e8b9f5f97646ea5557e6a034e991a1b885a63dffa` |
| Block | 40971241 |
| Gas used | 1078904 |
| Deployer | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` (facilitator EOA — software signed via `RECKON402_DEPLOYER_PK`) |
| Salt | `0x4a4fa727818b428e95b9b5667fbe477722b98a26002f738f629b6e24dbac2bb5` (`keccak256("reckon402-l4d-probe-2026-05-02-v2")`) |
| agentId | `1` |
| facilitatorClient | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` |
| tierStrategy | `0xc498155bC4A2E4Ba979Ad5797298107c63B26C4e` (the strategy above) |
| tag1 / tag2 | `"payment"` / `"x402-settlement"` |
| Basescan | https://sepolia.basescan.org/address/0xEa8BEd2bEE679276F78DeCa49eE8B531f0ADaF78 |

### Smoke results (post-deploy reads, 2026-05-02)

| Read | Value | Notes |
|------|-------|-------|
| `owner()` | `0x21fdEd74C901129977B8e28C2588595163E1e235` | Live `IdentityRegistry.ownerOf(1)` — the seller EOA registered with agentId=1 |
| `attestationCount()` | `16` | Live `ReputationRegistry.getSummary(1, [facilitator], "payment", "x402-settlement").count` — 16 facilitator-signed L4b1 attestations to date |
| `releasedBps()` | `3000` | Strategy's `evaluate(1, 16)` — 16 ≥ T3 threshold (10) but < T4 threshold (30) → 30% |
| `totalDeposited()` / `currentlyHeld()` / `totalWithdrawn()` | `0` / `0` / `0` | Probe Escrow is empty by design (no Splitter wired to it yet) |

### Owner-gate revert smoke

```
$ cast call 0xEa8B…aF78 "withdraw(uint256)" 1 \
    --from 0x0A0228…c455 \
    --rpc-url $BASE_SEPOLIA_RPC_PRIMARY
Error: execution reverted, data: "0x30cd7471"
```

`0x30cd7471` is the selector for `Escrow.NotOwner()`. The non-owner
withdraw cleanly reverts; the NFT-bound owner gate is functional in
deployed bytecode.

### Cross-contract delegation evidence

The full chain `Escrow.releasedBps() → ITierStrategy.evaluate() →
ReputationRegistry.getSummary()` round-trips through three live
contracts on Base Sepolia:

```
Escrow.releasedBps()         = 3000
Strategy.evaluate(1, 16)     = 3000  (must match)
Strategy.evaluate(0, 16)     = 3000  (agentId-agnostic in v1)
```

Confirmed via direct `cast call` on each surface during the smoke
window above.

### Stale evidence (superseded — do NOT use)

The first L4d deploy on 2026-05-02 used the old (pre-pluggable)
constructor shape and is now stale evidence:

| Item | Address | Status |
|------|---------|--------|
| EscrowFactory v1 (stale) | `0xb57ada3c2edffb5ce250b495d16d47e120d33d8b` | NOT USED — predates Q-09-5 resolution. Kept on-chain as immutable history of the L4d-deployed tag. |
| Probe Escrow v1 (stale) | `0x4f79aA82E7cf4e09Be9add4Df61887d270cFD95E` | NOT USED — wired to the stale factory. |

Upstream consumers (orchestrator E2, frontend E3) MUST point at the
canonical pluggable-strategy addresses recorded in the tables above.

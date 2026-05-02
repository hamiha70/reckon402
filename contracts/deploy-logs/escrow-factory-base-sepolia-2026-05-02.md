# EscrowFactory deploy — Base Sepolia — 2026-05-02

| Field | Value |
|-------|-------|
| EscrowFactory address | `0xb57ada3c2edffb5ce250b495d16d47e120d33d8b` |
| Deploy tx | `0xc5826f3485b8ec4388c6e9ccf8b12f1257797ab0b66a9fbf222d8db37a2ff8f2` |
| Block | 40970567 |
| Gas used | 2347208 |
| Deployer | `0x66c2858d9a8605957c516a77262eb66ee6be113c` (KMS `alias/reckon402/mainnet/deployer/evm`) |
| Token (USDC) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Basescan | https://sepolia.basescan.org/address/0xb57ada3c2edffb5ce250b495d16d47e120d33d8b |
| Basescan tx | https://sepolia.basescan.org/tx/0xc5826f3485b8ec4388c6e9ccf8b12f1257797ab0b66a9fbf222d8db37a2ff8f2 |

## Probe Escrow (smoke test) — agentId=1

Deployed via `factory.createEscrow(...)` to verify the per-agent
deploy path round-trips against a known-good agent that already has
L4b1 attestation history in the ReputationRegistry on Base Sepolia.

| Field | Value |
|-------|-------|
| Probe Escrow address | `0x4f79aA82E7cf4e09Be9add4Df61887d270cFD95E` |
| Probe deploy tx | `0xe92f34cdb59129ff20ff589a34a76c34dd1c9a6e0752a0ac7695424ba1c2be66` |
| Probe deploy block | 40970580 |
| Salt | `0x4af957bbbf770920e627aa40cc25349c6ff51dc99066957bde254f08c5563441` (= `keccak256("reckon402-l4d-probe-2026-05-02")`) |
| Signer | `RECKON402_DEPLOYER_PK` → `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` (factory has no admin; anyone can call `createEscrow`) |
| agentId | 1 |
| facilitatorClient | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` (Reckon402 facilitator) |
| Tier curve | thresholds = `[0, 1, 3, 10, 30, 100, 300, 1000]`<br>releaseBps = `[0, 500, 1500, 3000, 5000, 7000, 8500, 10000]` |
| Tags | `(payment, x402-settlement)` |
| Predicted address (CREATE2) | `0x4f79aA82E7cf4e09Be9add4Df61887d270cFD95E` (matches deployed) |
| Basescan | https://sepolia.basescan.org/address/0x4f79aa82e7cf4e09be9add4df61887d270cfd95e |
| Basescan tx | https://sepolia.basescan.org/tx/0xe92f34cdb59129ff20ff589a34a76c34dd1c9a6e0752a0ac7695424ba1c2be66 |

### Smoke results

State reads — all green:

| view | result | notes |
|------|--------|-------|
| `owner()`              | `0x21fdEd74C901129977B8e28C2588595163E1e235` | Current IdentityRegistry NFT owner of agentId=1 |
| `agentId()`            | `1`                                            | matches constructor arg |
| `facilitatorClient()`  | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`   | matches AGENTS.md L4b1 lock |
| `attestationCount()`   | `16`                                           | 16 facilitator-signed `(payment, x402-settlement)` rows for agentId=1 — proves the cross-contract `getSummary` read works |
| `releasedBps()`        | `3000` (= 30%)                                 | 16 attestations → T3 (between thresholds 10 and 30) |
| `totalDeposited()`     | `0`                                            | empty Escrow; no settlements through this address yet |
| `currentlyHeld()`      | `0`                                            | matches |
| `totalWithdrawn`       | `0`                                            | matches |

Owner-gate revert smoke — green:

```
$ cast call <ESCROW> "withdraw(uint256)" 1 \
    --from 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455 \
    --rpc-url $BASE_SEPOLIA_RPC_PRIMARY
Error: execution reverted, data: "0x30cd7471"
```

`0x30cd7471` = `keccak256("NotOwner()")[:4]`. Confirms the
`IdentityRegistry.ownerOf(agentId) != msg.sender` check fires correctly
on the deployed bytecode.

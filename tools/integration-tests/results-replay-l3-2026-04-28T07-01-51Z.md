# L3 replay integration test — 2026-04-28T07-01-51Z

| Field | Value |
|-------|-------|
| Replay nonce | `0x70f80ba004f26f53082ed12b19bc9a8ebb5608763adcc1bdd95dc7ba9fb9cf04` |
| paymentId | `0x9aca8ee87e9f123dc3775a0e3d6f2c3880166269f5d5dec5dcb1939492e01bbc` |
| Original tx | `0x5efd44aa122f807113ad036328c74589dd65c803ea30bed281acb32f852ea6e5` |
| Replay tx | `0x5efd44aa122f807113ad036328c74589dd65c803ea30bed281acb32f852ea6e5` |
| Match | YES (no new on-chain tx) |
| Receipt state | CONFIRMED |

Artifacts: `/home/hamiha70/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402/tools/integration-tests/run-replay-l3-2026-04-28T07-01-51Z/` (200 headers, payment-response.json, receipt.json, buyer-sign.stderr).

Load-bearing claim: the second /x402/settle call short-circuited from D1
(see workers/facilitator/src/settle-route.ts:72 replay-shortcut). The
facilitator EOA submitted ZERO new on-chain txs for the replay call — the
buyer pays once, the merchant sees both requests succeed, the chain state
is stable, D1 enforces per-paymentId idempotency.

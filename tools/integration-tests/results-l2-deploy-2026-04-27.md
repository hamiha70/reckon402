# L2 paywall integration run log — 2026-04-27

Run by: claude-sonnet-4-6 (L2 build agent)
Date: 2026-04-27
Outcome: ALL PASS — on-chain USDC transfer confirmed on Base Sepolia

---

## Deploy output

```
⛅️ wrangler 4.85.0
───────────────────
Total Upload: 100.61 KiB / gzip: 24.47 KiB
Worker Startup Time: 2 ms
Uploaded reckon402-agent (4.89 sec)
Deployed reckon402-agent triggers (4.46 sec)
  agent.reckon402.com (custom domain)
Current Version ID: 89a7f957-48af-492c-8307-88ebc80b7f99
```

---

## 402 path (no payment header)

```
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbi...
{"error":"Payment required","x402Version":2}
```

Decoded PAYMENT-REQUIRED header:
```json
{
  "x402Version": 2,
  "resource": { "url": "https://agent.reckon402.com/research?q=test" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xD53ffac42496d73B3Faf946786688a8454F57b1f",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDC", "version": "2" }
  }]
}
```

---

## 200 path (with valid PAYMENT-SIGNATURE)

Buyer: `0x837e30740a4A5bAC5480b4f707924469d42b43De` (Buyer-demo-1)
Seller: `0xD53ffac42496d73B3Faf946786688a8454F57b1f`
Amount: 10000 base units (0.01 USDC)
Network: eip155:84532 (Base Sepolia)

buyer-sign.mjs output (stderr):
```
[buyer-sign] buyer=0x837e30740a4A5bAC5480b4f707924469d42b43De
[buyer-sign] seller=0xD53ffac42496d73B3Faf946786688a8454F57b1f
[buyer-sign] amount=10000 (0.01 USDC)
[buyer-sign] network=eip155:84532
[buyer-sign] validBefore=1777322120 (2026-04-27T20:35:20.000Z)
[buyer-sign] nonce=0x4bd825832b4257a8c997a5e274f4db65bbb7d78cd2f2f3113b1dc781735715cb
[buyer-sign] paymentId=0x712db964fdc315c252b10aea17a3a1fbb08275aefd2db59279b2a2984550b669
[buyer-sign] signature=0xd6934a58e68b7a2e7299854fc5bd7d1e0c6a872a0715d4e0211f1815ade748337b...1b
```

HTTP response:
```
HTTP/2 200
payment-response: eyJzdWNjZXNzIjp0...
{"query":"test","summary":"This is a stub response...","agent":"reckon402-demo-research","layer":"L2"}
```

Decoded PAYMENT-RESPONSE header:
```json
{
  "success": true,
  "transaction": "0x8c93d025578b42f61268053adf99ba0e3a3b58048f1320d4751c9402a09639ad",
  "network": "eip155:84532",
  "payer": "0x837e30740a4A5bAC5480b4f707924469d42b43De"
}
```

---

## On-chain verification

**Transaction 1** (integration test run 1):
- tx hash: `0x8c93d025578b42f61268053adf99ba0e3a3b58048f1320d4751c9402a09639ad`
- Basescan: https://sepolia.basescan.org/tx/0x8c93d025578b42f61268053adf99ba0e3a3b58048f1320d4751c9402a09639ad
- blockNumber: 40776624
- `to`: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (USDC on Base Sepolia)
- `input`: `0xe3ee160e...` (transferWithAuthorization selector)
  - from: `0x837e30740a4A5bAC5480b4f707924469d42b43De`
  - to: `0xD53ffac42496d73B3Faf946786688a8454F57b1f`
  - value: `0x2710` = 10000 (0.01 USDC)

**Transaction 2** (wrangler tail test run):
- tx hash: `0x87088a3f9d336ab188e7ce4c228e7e21f7781213327b4321a8ab3ee4c8ceaa08`
- Basescan: https://sepolia.basescan.org/tx/0x87088a3f9d336ab188e7ce4c228e7e21f7781213327b4321a8ab3ee4c8ceaa08

cast tx excerpt (Tx 1):
```
blockNumber          40776624
from                 0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf
to                   0x036CbD53842c5426634e7929541eC2318f3dCF7e
input                0xe3ee160e0000...00002710...
```

---

## wrangler tail capture (verify+settle round-trip)

```json
{
  "outcome": "ok",
  "scriptName": "reckon402-agent",
  "logs": [
    {
      "message": ["[x402] paymentId=0x26fc71b73acceffe7e178f7e836cd2075cda5fefe84964a999d191275445d2e7 payer=0x837e30740a4A5bAC5480b4f707924469d42b43De"],
      "level": "log",
      "timestamp": 1777321614674
    },
    {
      "message": ["[x402] settled paymentId=0x26fc71b73acceffe7e178f7e836cd2075cda5fefe84964a999d191275445d2e7 tx=0x87088a3f9d336ab188e7ce4c228e7e21f7781213327b4321a8ab3ee4c8ceaa08 network=eip155:84532"],
      "level": "log",
      "timestamp": 1777321615628
    }
  ],
  "event": {
    "request": { "url": "https://agent.reckon402.com/research?q=tail-test", "method": "GET" },
    "response": { "status": 200 }
  }
}
```

---

## Unit test results

```
Test Files  3 passed (3)
     Tests  13 passed (13)
  Duration  920ms
```

---

## Definition of done — status

- [x] `specs/03-l2-x402-paywall.md` committed (commit 1: aa3af99)
- [x] `packages/types/` committed; `pnpm install` resolves cleanly (commit 2: a01b0ed)
- [x] `workers/agent/` extension committed; all 13 vitest tests pass (commit 3: ecf9aad)
- [x] `tools/integration-tests/{buyer-sign.mjs, agent-paywall.sh}` + run log (commit 4: this)
- [x] `agent-paywall.sh` exits 0 against live `agent.reckon402.com`
- [x] Real on-chain tx: 10000 base-unit USDC from 0x837e...43De to 0xD53f...7b1f on Base Sepolia
- [x] `wrangler tail` captured one verify+settle round-trip

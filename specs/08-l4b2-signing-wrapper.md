# Spec 08 — L4b₂: Lambda signing wrapper + KH skill + recipes

Status: implementation contract.

Sources: `AGENTS.md` (KMS keys, EOA topology, L4b1 deployed state),
`specs/06-actor-act-matrix.md` (L4b framing locks), design pack
`04_signing_wrapper.md` (infrastructure + HTTP API + KMS internals),
`05_recipes_and_demo.md` (KH workflow shape + recipe formats).

---

## 1. Purpose and scope

L4b₂ ships the hosted EIP-3009 signing wrapper at `signing.reckon402.com`
plus the KeeperHub deliverables (skill + workflow JSON) and three
reproducibility recipes (curl, viem, Python).

**What L4b₂ ships:**

- **`lambda/signing/`** — AWS Lambda (Node.js 20, TypeScript) deployed
  at `https://signing.reckon402.com/sign`. Single endpoint `POST /sign`
  accepting scoped `TransferWithAuthorization` typed-data, signing via
  KMS buyer-signer key, returning 65-byte canonical Ethereum signature.
  Secondary endpoints: `GET /healthz`, `GET /signer`.
- **IAM execution role** `reckon402-signing-wrapper-role` with
  `kms:Sign` + `kms:GetPublicKey` on the buyer-signer key ARN only.
- **API Gateway HTTP API** in `eu-central-1` + custom domain CNAME
  `signing.reckon402.com` pointing at the API endpoint (Cloudflare DNS).
- **`recipes/kh-workflow.json`** — KH workflow definition for 3
  sequential paid calls to `agent.reckon402.com/research`.
- **`packages/kh-skill/`** — `@reckon402/kh-skill` skill package
  (stub that wraps the hosted signing wrapper + buyer-sdk flow).
- **Three reproducibility recipes** in `recipes/`:
  `curl-recipe.sh`, `viem-recipe.ts`, `python-recipe.py` (drop-flagged).
- **`FEEDBACK.md`** in repo root — KH builder feedback bounty artifact.
- **Unit tests** in `lambda/signing/test/unit/`.
- **`AGENTS.md ## L4b2` section** with deployment IDs, integration
  smoke output (raw curl response + recovered address), and test counts.

**What L4b₂ does NOT ship:**

- No second KMS signing endpoint beyond EIP-3009 `TransferWithAuthorization`.
- No arbitrary digest signing (`MessageType=RAW`).
- No Morpho deposits (drop-flagged per AGENTS.md `## N.6`).
- No DXa buyer-satisfaction attestations (permanently not shipped per D13).

---

## 2. Lambda HTTP API

### 2.1 `POST /sign`

**Request (JSON body):**

```ts
{
  typedData: {
    domain: {
      name:              "USD Coin",    // literal
      version:           "2",           // literal
      chainId:           84532 | 8453,  // Base Sepolia | Base mainnet
      verifyingContract: string,         // USDC address on that chain
    },
    types: {
      TransferWithAuthorization: Array<{ name: string; type: string }>,
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from:        string,  // MUST equal KMS-derived EOA
      to:          string,  // splitter address
      value:       string,  // uint256 USDC atomic units; ≤ 10_000_000 (10 USDC)
      validAfter:  string,
      validBefore: string,  // unix sec; must be > now
      nonce:       string,  // 0x-prefixed bytes32
    },
  },
  context?: {
    paymentId?: string;
    requestId?: string;
  },
}
```

**Auth:** `X-API-Key: <SIGNING_WRAPPER_API_KEY>` header.

**Response (200):**

```ts
{
  signature:    "0x<130-hex-char>",  // 65-byte r||s||v
  signerAddress: "0x...",            // matches message.from
}
```

**Validator hard rules (all checked before KMS call):**

1. `primaryType === "TransferWithAuthorization"`
2. `domain.name === "USD Coin"` and `domain.version === "2"`
3. `domain.chainId` in `[84532, 8453]`
4. `domain.verifyingContract` matches allowlist for that chainId
5. `message.from` equals pinned KMS EOA (case-insensitive)
6. `message.value` ≤ `10_000_000n` (10 USDC)
7. `message.validBefore > now`

Any violation → 400 with `{ error: "<code>", message: "..." }`.

### 2.2 `GET /healthz`

```ts
→ { status: "ok" | "down", kms_reachable: boolean, signer_eoa: string }
```

### 2.3 `GET /signer`

```ts
→ { signerAddress: string }
```

---

## 3. KMS signing internals

### 3.1 EOA derivation (cached at boot)

```ts
const out = await kms.send(new GetPublicKeyCommand({ KeyId }));
// DER SubjectPublicKeyInfo → 65-byte uncompressed pubkey
const uncompressed = parseDerSpki(out.PublicKey);  // 0x04 || X || Y
const xy = uncompressed.slice(1);                   // 64 bytes
const eoa = ("0x" + keccak256(xy).slice(-40)) as Hex;
```

### 3.2 DER SubjectPublicKeyInfo parse

KMS returns the public key as DER-encoded SubjectPublicKeyInfo (SPKI).
Structure: `SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING }`.
The BIT STRING payload is the 65-byte uncompressed EC point (0x04 prefix).

```ts
function parseDerSpki(der: Uint8Array): Uint8Array {
  // skip outer SEQUENCE tag + length
  let i = 2;
  if ((der[1] & 0x80) !== 0) i = 2 + (der[1] & 0x7f);
  // skip inner SEQUENCE (algorithm identifier)
  const algSeqLen = der[i + 1];
  i += 2 + algSeqLen;
  // BIT STRING tag 0x03 + length + 0x00 (unused bits) + pubkey
  if (der[i] !== 0x03) throw new Error("DER_NO_BITSTRING");
  i += 2;  // skip tag + length (single-byte for 66-byte bitstring)
  i += 1;  // skip unused-bits byte (0x00)
  return der.slice(i);  // 65 bytes: 0x04 || X || Y
}
```

### 3.3 Signature DER parse

KMS returns DER-encoded ECDSA signatures: `SEQUENCE { r INTEGER, s INTEGER }`.

```ts
function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error("DER_NOT_SEQUENCE");
  let i = 2;
  if ((der[1] & 0x80) !== 0) i = 2 + (der[1] & 0x7f);
  if (der[i] !== 0x02) throw new Error("DER_R_NOT_INTEGER");
  const rLen = der[i + 1];
  const rBytes = der.slice(i + 2, i + 2 + rLen);
  const r = bytesToBigInt(rBytes.at(-1) === undefined || rBytes[0] === 0 ? rBytes.slice(rBytes[0] === 0 ? 1 : 0) : rBytes);
  i += 2 + rLen;
  if (der[i] !== 0x02) throw new Error("DER_S_NOT_INTEGER");
  const sLen = der[i + 1];
  const sBytes = der.slice(i + 2, i + 2 + sLen);
  const s = bytesToBigInt(sBytes[0] === 0 ? sBytes.slice(1) : sBytes);
  return { r, s };
}
```

### 3.4 Low-S normalization

```ts
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
function normalizeLowS(s: bigint): bigint {
  return s > SECP256K1_N >> 1n ? SECP256K1_N - s : s;
}
```

### 3.5 v-recovery

```ts
function recoverV(digest: Hex, r: bigint, s: bigint, expected: Hex): 27 | 28 {
  for (const v of [27, 28] as const) {
    const sig = encodeRsv(r, s, v);
    if (recoverAddress({ hash: digest, signature: sig }).toLowerCase() === expected.toLowerCase()) return v;
  }
  throw new Error("V_RECOVERY_FAILED");
}
```

### 3.6 EIP-712 digest computation

```ts
const digest = hashTypedData(typedData);
```

Using viem's `hashTypedData` from `viem/utils`. This is the canonical
EIP-712 digest: `keccak256(0x1901 || domainSeparator || hashStruct)`.

---

## 4. Infrastructure

| Item | Value |
|------|-------|
| Runtime | Node.js 20.x |
| Memory | 256 MB |
| Timeout | 5s |
| Region | `eu-central-1` |
| Lambda function name | `reckon402-signing-wrapper` |
| Execution role | `reckon402-signing-wrapper-role` |
| API Gateway | HTTP API (v2 payload format), stage `$default` |
| Custom domain | `signing.reckon402.com` (CNAME in Cloudflare DNS) |
| KMS key | `5a0350e0-d502-4579-8d45-d31c843a5f3f` (buyer-signer) |
| Env vars | `KMS_KEY_ID`, `PINNED_EOA`, `SIGNING_WRAPPER_API_KEY` |

IAM policy on execution role (least-privilege):
```json
{
  "Effect": "Allow",
  "Action": ["kms:Sign", "kms:GetPublicKey"],
  "Resource": "arn:aws:kms:eu-central-1:975170806362:key/5a0350e0-d502-4579-8d45-d31c843a5f3f"
}
```

---

## 5. KH skill and workflow

### 5.1 `packages/kh-skill/` — `@reckon402/kh-skill`

Thin skill shim over `@reckon402/buyer-sdk`. Input:
`{ merchantUrl, path, query, amountUsdc }`. Steps:
1. Resolve ENS via CCIP-Read.
2. POST typed-data to `signing.reckon402.com/sign`.
3. POST payment header to merchant.
4. Poll for receipt.

Output: `{ receiptId, tx, reputation: { count } }`.

### 5.2 `recipes/kh-workflow.json`

Three sequential `reckon402-buyer` nodes against
`agent.reckon402.com/research`, each depending on the prior node's
`RECONCILED` state. Third node reads updated reputation.

---

## 6. Recipes

| File | Description |
|------|-------------|
| `recipes/curl-recipe.sh` | ~20-line bash; signs with test private key, posts to `agent.reckon402.com/research` |
| `recipes/viem-recipe.ts` | ~40-line TypeScript; uses `@reckon402/buyer-sdk` |
| `recipes/python-recipe.py` | ~30-line Python (`requests` + `eth_account`); drop-flagged |

---

## 7. Open questions

| ID | Question | Resolution |
|----|----------|------------|
| Q-08-1 | ACM cert in `eu-central-1` vs `us-east-1` for regional API Gateway | Regional API Gateway uses regional cert in same region; ACM cert in `eu-central-1` |
| Q-08-2 | CNAME propagation time for `signing.reckon402.com` | Cloudflare is usually near-instant; retry deploy if not propagated |

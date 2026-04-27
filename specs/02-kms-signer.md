# Spec 02 — KMS signer (viem `LocalAccount` over AWS KMS)

Status: implementation contract.
Owner: `tools/sign/` (workspace package `@reckon402/sign`).

## Purpose

Provide a [viem](https://viem.sh) `LocalAccount`-shaped adapter that
signs Ethereum payloads using a non-exportable AWS KMS secp256k1 key.
The adapter is the single signing entrypoint for any reckon402 code path
that needs to broadcast transactions or attach EIP-712 / EIP-191
signatures attributable to a KMS-resident EOA.

Two specific consumers, locked by `specs/01-eoa-topology.md`:

| Consumer | KMS key alias | First use |
|----------|---------------|-----------|
| Deploy scripts (Splitter, settle relays, fund-fanout) | `alias/reckon402/mainnet/deployer/evm` | L0 onwards |
| Buyer SDK + signing wrapper Lambda | `alias/reckon402/mainnet/buyer-signer/evm` | L3 / L4 |

A third consumer (the Lambda signing wrapper) reuses the same module
verbatim; it just runs in a different process boundary. The package
intentionally has no Lambda-specific surface — it speaks viem-account
on both sides.

## Why fresh code (not a port of `x402commit/kms-signer.ts`)

`AGENTS.md` hard rule "Public OSS, fresh code only" forbids importing
or copy-pasting `~/Projects/x402commit/.../src/kms-signer.ts`. That
prior implementation is a useful **shape reference** — the technical
contract (DER parsing, low-S, v-recovery, viem `LocalAccount` slots)
is well-understood from public ECDSA / SEC1 / EIP-2 specifications and
the viem source — but every line of code in this package is
re-authored against those public sources in the current build window.

In-repo reuse is encouraged: the existing
`tools/smoke-tests/lib/kms-verify.mjs` (committed earlier this session)
solved the GetPublicKey + Sign + recover loop and remains the
canonical L0 ownership-proof probe. The signer package writes its
primitives independently to avoid coupling the L0 probe to the L1+
adapter; consolidating to a shared `kms-primitives` module is a
post-L4 cleanup task explicitly out of scope here.

## Public API

```ts
// tools/sign/kms-account.mjs (workspace package @reckon402/sign)

import type { LocalAccount } from "viem";

export interface KmsAccountOptions {
  // KMS key alias, e.g. "alias/reckon402/mainnet/deployer/evm".
  // Plain key IDs accepted but aliases are preferred for log readability.
  keyAlias: string;
  // AWS region. Defaults to "eu-central-1" (project lock).
  region?: string;
}

export async function kmsAccount(
  opts: KmsAccountOptions,
): Promise<LocalAccount>;
```

The returned `LocalAccount` satisfies `type: "local"`, `source: "custom"`,
and exposes the four signing slots viem expects:

- `address: 0x{40}` — derived from `kms:GetPublicKey` once at construction
  and frozen for the account's lifetime.
- `sign({ hash }): Promise<0x{r}{s}{v}>` — internal primitive over a
  32-byte hash.
- `signMessage({ message }): Promise<sig>` — wraps `viem.hashMessage`
  then `sign`.
- `signTransaction(tx): Promise<rawTx>` — serializes unsigned tx,
  hashes, signs, re-serializes with `{r, s, v}` attached so the result
  is broadcastable via `eth_sendRawTransaction`.
- `signTypedData(params): Promise<sig>` — wraps `viem.hashTypedData`
  then `sign`.

`v` packed in returned signatures uses `yParity ∈ {0, 1}` (the form
viem accepts at all signature-verification surfaces and the form
typed-transaction RLP requires natively). Legacy-EIP-155 broadcasts
work because viem's `serializeTransaction` re-derives the EIP-155 v
from yParity + chainId at serialization time.

## Internals (sequence per call)

### Construction

```
GetPublicKey(keyAlias)
  -> DER SubjectPublicKeyInfo (88 bytes for ECC_SECG_P256K1)
  -> extract trailing 65 bytes (0x04 || X || Y)
  -> address = "0x" + keccak256(X || Y).slice(-20)
  -> cache (keyAlias) -> address per-process
```

Cache key is `${region}:${keyAlias}`. The cache is a plain `Map` in the
module-level closure — no external store, no TTL. KMS pubkeys are
immutable for the life of a key, so caching is safe.

### Per-`sign` call

```
KMSClient.send(SignCommand({
  KeyId: keyAlias,
  Message: hashBytes,
  MessageType: "DIGEST",
  SigningAlgorithm: "ECDSA_SHA_256",
}))
  -> DER signature
  -> parse to {r, s} as bigints
  -> normalize s to low-S (s > N/2 ? N - s : s, where N = secp256k1 order)
  -> for v in [0, 1]:
       sigHex = `0x${r:64}${s:64}${v:02x}`
       if recoverAddress({ hash, signature: sigHex }) == address: return sigHex
  -> throw "v recovery exhausted" (unreachable for well-formed inputs)
```

ECDSA signing requires randomness; KMS supplies that internally. The
adapter is therefore non-deterministic across calls (two `signMessage`
calls on the same input produce different signatures). This is correct
behaviour and matches every other ECDSA signer.

### DER parsing notes

Two DER blobs to parse, both fixed by AWS KMS' wire format:

- **Public key** (`GetPublicKey.PublicKey`): X.509 SubjectPublicKeyInfo
  for `id-ecPublicKey` + `secp256k1`. Always 88 bytes; trailing 65 are
  `0x04 || X(32) || Y(32)`. Tail-extract approach is safe — the prefix
  is deterministic and we sanity-check the `0x04` marker.
- **Signature** (`Sign.Signature`): DER ECDSA signature, RFC 3279 / X9.62.
  Structure `0x30 <total> 0x02 <rLen> <r> 0x02 <sLen> <s>`. Length-prefix
  bytes can have a long-form encoding when total > 127, so the parser
  must read the length explicitly rather than assume a fixed offset.
  Leading 0x00 padding bytes on `r` / `s` (DER signed-int convention)
  are stripped before BigInt conversion.

### KMS error model

The adapter does not retry. KMS Sign throws on:

- `AccessDeniedException` — IAM user lacks `kms:Sign` on the key ARN.
- `KMSInvalidStateException` — key is disabled or pending deletion.
- `ThrottlingException` — TPS exceeded; caller decides whether to retry.

For reckon402's L0–L4 scope, calls are rare enough (< 1 / sec) that
retry is unnecessary; documented here so consumers know failure modes
surface cleanly to the caller rather than being swallowed by the
adapter.

## Configuration

| Env | Required by | Notes |
|-----|-------------|-------|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | All | Hydrated from Infisical via `infisical run`. The buyer-signer key uses `AWS_ACCESS_KEY_ID` (legacy slot, IAM user `reckon402-signer`); the deployer key uses `DEPLOYER_AWS_ACCESS_KEY_ID` (IAM user `reckon402-deployer`). The convention is that callers `export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"` (and same for secret) at the top of any deploy script that uses the deployer key. |
| `AWS_REGION` | All | Defaults to `eu-central-1` if unset. The `region` argument to `kmsAccount({ region })` overrides this. |

The adapter does NOT read `AWS_KMS_KEY_ID` or any other "magic" env
var — all configuration flows through the `kmsAccount(opts)` argument.
This makes it trivial to instantiate two accounts side-by-side
(deployer + buyer-signer) in the same process when L4 needs both.

## Test plan

`tools/sign/verify-kms-account.mjs` covers three sign+recover cases.
All three are offline (no broadcast, no funded EOA needed):

| # | Method | Hash function | Verifier |
|---|--------|---------------|----------|
| 1 | `signMessage({ message: "reckon402 KMS signer ownership proof <date>" })` | `viem.hashMessage` (EIP-191 prefix) | `viem.verifyMessage` |
| 2 | `signTypedData({ domain, types, primaryType, message })` (minimal EIP-712 payload, domain `name=reckon402` `version=1` `chainId=84532`) | `viem.hashTypedData` | `viem.verifyTypedData` |
| 3 | `signTransaction({ chainId: 84532, type: "eip1559", nonce: 0n, maxFeePerGas, maxPriorityFeePerGas, gas: 21000n, to, value: 0n })` | `viem.serializeTransaction` then `keccak256` of the unsigned bytes | `viem.parseTransaction` round-trip + recover sender from the parsed signature |

Test 3 deliberately does NOT broadcast. The reckon402 deployer is
unfunded at the time of this commit (Sepolia ETH funding lands as
task C in the L0 work plan). A signed-but-unbroadcast tx is sufficient
to prove the adapter generates byte-correct EIP-1559 RLP that recovers
back to the KMS-derived EOA.

A passing run against `alias/reckon402/mainnet/deployer/evm` produces
`expectedAddress = 0x66c2858d9a8605957c516a77262eb66ee6be113c` for all
three cases. A passing run against `alias/reckon402/mainnet/buyer-signer/evm`
produces `0x46bbb05aca9ea24118b8a57c8d3f317503384305` (cross-checked
against the existing `tools/smoke-tests/lib/kms-verify.mjs` output).

## Deployment / promotion path

Today (L0–L2):
```
tools/sign/                              # workspace pkg @reckon402/sign
├── package.json
├── kms-account.mjs                      # public adapter
├── verify-kms-account.mjs               # test plan above
└── results-<date>.md                    # captured run logs
```

When L3 lands `packages/buyer-sdk/` and the buyer SDK needs to import
this adapter as a typed dependency, the `.mjs` source moves to
`packages/kms-signer/src/index.ts` and the `tools/sign/` package
becomes a thin `bin` wrapper that re-exports from the typed package.
That migration is its own L3 work item; nothing in this spec
prejudges its commit shape.

## Forward-compat hooks

- **Multi-key per process.** `kmsAccount()` is a factory; the address
  cache is keyed on `(region, keyAlias)`, so calling it twice with
  different aliases yields two independent accounts.
- **Alternative curves.** Spec is locked to `ECC_SECG_P256K1`. KMS
  also supports `ECC_NIST_P256` etc. but those are not Ethereum-native
  and are out of scope.
- **EIP-7702 sponsored auth.** The adapter signs hashes; EIP-7702
  authorization tuples are also a hash signature, so they go through
  the same `sign({ hash })` path with no adapter changes. Out of scope
  for L0–L4 demo but the adapter doesn't need to grow new surface to
  support it.

## Open questions

None blocking. Tracked separately if surfaced in implementation.

# L4b₁ Secrets — what you need, where to get it, how to paste it

Operator runbook for every secret touched by the L4b₁ deploy. Each
entry says: what it is, where it lives, how to get / generate it, and
how to push it into Infisical (which is the hydration source for
`wrangler secret put` calls during deploy).

---

## Secret map — at a glance

| Name | Who uses it | Where it lives | Generate? | Status for L4b₁ |
|------|-------------|----------------|-----------|-----------------|
| `FACILITATOR_PK` | facilitator worker (signs on-chain txs) | Infisical `reckon402/dev` | Already set at L3 | **Reuse as-is** |
| `BASE_SEPOLIA_RPC_PRIMARY` | facilitator + preflight | Infisical `reckon402/dev` (Alchemy RPC URL) | Already set at L0 | **Reuse as-is** |
| `BASE_SEPOLIA_RPC_FALLBACK` | facilitator (optional secondary RPC) | Infisical `reckon402/dev` | Already set at L0 | **Reuse as-is** |
| `GATEWAY_CACHE_HOOK_TOKEN` | gateway (L4a2) + facilitator (L4b₁) | Infisical `reckon402/dev` | **Generated at L4a2** | **Use existing value** (see §1 below) |
| `BUYER_DEMO_1_PK` | integration smoke tests (signs EIP-3009) | Infisical `reckon402/dev` | Already set at L3 | **Reuse as-is** |
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` auth | Infisical `reckon402/dev` | Already set at L0 | **Reuse as-is** |
| `DEPLOYER_AWS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | `preflight-l3` KMS probe | Infisical `reckon402/dev` | Already set at L0 | **Reuse as-is** |

**Summary:** L4b₁ introduces **NO new secrets**. The only action is
confirming `GATEWAY_CACHE_HOOK_TOKEN` is present in Infisical and is
identical to the value the gateway worker holds.

---

## 1. `GATEWAY_CACHE_HOOK_TOKEN`

### What it is

Shared bearer token between the facilitator (caller) and the gateway
(callee). Used to authenticate POSTs to
`https://gateway.reckon402.com/hooks/cache-invalidate` from the
facilitator after a successful ERC-8004 write.

**Security profile:** not a signing key, not a chain credential.
Compromise risks: someone can force cache invalidations on the
gateway (no on-chain effect; worst-case blows the gateway's
erc8004_cache table and induces a tiny bit of extra Alchemy RPC
billing). Rotate if leaked, but no emergency.

### Where it should already be

The token was generated during the L4a2 deploy and stored in:
- **Infisical** `reckon402/dev` → key `GATEWAY_CACHE_HOOK_TOKEN`
- **Gateway worker secrets** (set via `wrangler secret put` from the
  Infisical value on both staging + production)

### How to confirm it's present

Check Infisical first:

```bash
infisical secrets get --env dev GATEWAY_CACHE_HOOK_TOKEN --plain 2>/dev/null \
  | (read t; [ -n "$t" ] && echo "Infisical GATEWAY_CACHE_HOOK_TOKEN: present (length=${#t})" || echo "Infisical: MISSING")
```

If MISSING, continue to §1a below. If present, continue to §1b.

### §1a — If the token is missing from Infisical

Two possibilities:

**(a) The token was never uploaded to Infisical; only set on the
gateway worker directly.** Recover by reading the value from your
local shell history or the session that originally deployed L4a2 —
the canonical value is whatever the gateway is currently
authenticating against. If that value is unrecoverable, follow
"Rotation" in `deploy-l4b.md` to generate a new token and redeploy
BOTH workers. Takes ~5 minutes.

**(b) The token exists in Infisical under a different env/name.**
`infisical secrets --env dev` lists all secrets. If you find it under
another name, copy it and upload under the canonical name:

```bash
~/Projects/aws_setup_2026/scripts/infisical-secret-put.sh \
  reckon402 dev GATEWAY_CACHE_HOOK_TOKEN "<pasted value>"
```

### §1b — If the token is present, push to the facilitator

This is the only non-reuse action in L4b₁.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  printf "%s" "$GATEWAY_CACHE_HOOK_TOKEN" | wrangler secret put GATEWAY_CACHE_HOOK_TOKEN
'
```

Verify:

```bash
cd workers/facilitator
wrangler secret list | grep GATEWAY_CACHE_HOOK_TOKEN
# Expect a single line echoing the secret name (not its value).
```

### §1c — How to generate a fresh token if you need to rotate

```bash
openssl rand -hex 32
# → 64-char hex string, e.g. "a3f9...d21"
```

Push the new value into Infisical, then push to BOTH workers (gateway
and facilitator) in the same session, then redeploy both. See the
"Rotation" section of `deploy-l4b.md` for the exact command sequence.

---

## 2. The other secrets (confirmation only)

### 2a. `FACILITATOR_PK` — 32-byte hex for the facilitator EOA

Already hydrated via Infisical at L3. The facilitator uses this to
sign:
- USDC `transferWithAuthorization` (L3)
- Splitter `distribute()` (L3)
- **ReputationRegistry `giveFeedback`** (new in L4b₁ — same key, one
  more `writeContract` call in the same wallet client).

Confirm it hasn't drifted:

```bash
just preflight-l3
# Probe 4: FACILITATOR_PK derives to 0x0A02…c455.
```

If the derivation mismatches AGENTS.md's locked facilitator EOA
(`0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`), STOP. The key has
drifted and Step 3 of `deploy-l4b.md` MUST be aborted until it's
resolved.

### 2b. `BASE_SEPOLIA_RPC_PRIMARY` / `BASE_SEPOLIA_RPC_FALLBACK`

Already hydrated at L0. The facilitator uses PRIMARY for all three
on-chain writes (settle + distribute + giveFeedback) and for the
`resolveAgentId` read of `Splitter.getRecipient(0)`. No change needed.

### 2c. `BUYER_DEMO_1_PK`

Only used by `full-flow-l4b.sh` (which wraps `full-flow-l3.sh`). No
change needed.

### 2d. `CLOUDFLARE_API_TOKEN`

Used by `wrangler deploy`. Already set.

### 2e. `DEPLOYER_AWS_ACCESS_KEY_ID` / `DEPLOYER_AWS_SECRET_ACCESS_KEY`

Used ONLY by the preflight probe (`preflight-l3.mjs`) to confirm the
KMS-derived deployer EOA matches the lock. Not used at runtime by the
facilitator. No change needed.

---

## 3. What is NOT a secret (but lives in env config)

These are set via `wrangler.toml [vars]` and commit into git. They
are not secrets; they are deployment configuration.

| Var | Value | Notes |
|-----|-------|-------|
| `ENABLE_ERC8004_WRITES` | `"false"` initially, flipped to `"true"` in a separate deploy commit | Master flag per spec §4.1. |
| `ERC8004_CHAIN_ID` | `"84532"` | Base Sepolia for demo. |
| `SELLER_AGENT_IDS` | `'{"0xd53ffac42496d73b3faf946786688a8454f57b1f":"1"}'` | JSON map; `resolveAgentId` seam per spec §4.3. |
| `GATEWAY_CACHE_HOOK_URL` | `"https://gateway.reckon402.com/hooks/cache-invalidate"` | Production gateway. |
| `ATTESTATION_FEEDBACK_URI_PREFIX` | `"https://facilitator.reckon402.com/x402/receipt/"` | Prefix for per-payment feedbackURI. |

All live in `workers/facilitator/wrangler.toml`. Do not move them to
secrets — they are public-safe.

---

## 4. Done-check before Step 1 of `deploy-l4b.md`

Paste this one-liner; it should print five lines, all starting with
`✓`:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
for var in FACILITATOR_PK BASE_SEPOLIA_RPC_PRIMARY GATEWAY_CACHE_HOOK_TOKEN BUYER_DEMO_1_PK CLOUDFLARE_API_TOKEN; do
  if [ -n "${!var:-}" ]; then echo "✓ $var present (len=${#!var})"; else echo "✗ $var MISSING"; fi
done
'
```

Any `✗` → resolve before proceeding.

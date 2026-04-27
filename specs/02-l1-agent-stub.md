# Spec 02 — L1: Bare Seller Agent on `agent.reckon402.com`

## 1. Purpose and scope

Deploy a static Hono worker to `agent.reckon402.com` that returns canned
JSON responses, wires up custom-domain DNS via Wrangler, and proves
end-to-end observability via `wrangler tail`. No x402 paywall, no env vars,
no `@reckon402/*` dependencies. L1 exists solely to establish the
deployment pipeline and DNS binding before L2 adds the paywall.

## 2. Routes and response shapes

| Method | Path | Status | Body |
|--------|------|--------|------|
| `GET` | `/research?q=<query>` | 200 | `{ query, summary, agent, layer }` |
| `GET` | `/research` (no `q`) | 400 | `{ error: "q is required" }` |
| `GET` | `/` | 200 | text/plain banner |
| `GET` | `/health` | 200 | `{ status: "ok", layer: "L1" }` |

### `/research?q=<query>` — 200

```json
{
  "query": "<value of q>",
  "summary": "This is a stub response. Real research is coming in a future layer.",
  "agent": "reckon402-demo-research",
  "layer": "L1"
}
```

### `/` — 200 (text/plain)

```
reckon402 demo research agent
Layer: L1 (stub — no paywall yet)
Try: GET /research?q=your+question
Health: GET /health
```

### `/health` — 200

```json
{ "status": "ok", "layer": "L1" }
```

## 3. Hard constraints

- Framework: **Hono 4.x** (module-worker syntax).
- Language: **TypeScript** — every file under `workers/agent/` is `.ts`.
- Runtime: **Cloudflare Workers** via `wrangler deploy`.
- Wrangler: **4.40.0** (local pnpm dep), invoked under `infisical run`.
- **No x402**: no `X-Payment`, no 402 response, no payment middleware.
- **No env vars required**: worker is fully static; no secrets needed.
- **No `@reckon402/*` dependencies**: those are L2+.
- `workers_dev = false`: disable the `.workers.dev` URL.
- `compatibility_date = "2026-04-27"`.

## 4. Wrangler config shape

```toml
name            = "reckon402-agent"
main            = "src/index.ts"
compatibility_date  = "2026-04-27"

account_id  = "0f38f8667bbcbe4f54eda13c8df009e0"
workers_dev = false

[[routes]]
pattern      = "agent.reckon402.com"
custom_domain = true
```

Custom Domain (not Zone Routes) is used because no A/CNAME record for
`agent.reckon402.com` exists yet. Wrangler auto-provisions the DNS record
and certificate on first `wrangler deploy`.

## 5. Test plan

### 5.1 Unit tests (vitest)

File: `workers/agent/test/index.test.ts`

Three test cases using `app.request()` directly (no Miniflare needed):

| # | Input | Expected status | Expected body (subset) |
|---|-------|-----------------|------------------------|
| 1 | `GET /health` | 200 | `{ status: "ok", layer: "L1" }` |
| 2 | `GET /research?q=ethereum` | 200 | `{ query: "ethereum", agent: "reckon402-demo-research", layer: "L1" }` |
| 3 | `GET /research` (no q) | 400 | `{ error: "q is required" }` |

Run: `pnpm --filter @reckon402/agent test`

### 5.2 Integration tests (bash)

File: `tools/integration-tests/agent.sh`

Curls all live routes against `https://agent.reckon402.com` and asserts:
- `/health` → HTTP 200 + `"ok"` in body.
- `/research?q=l1-test` → HTTP 200 + `"reckon402-demo-research"` in body.
- `/research` (no q) → HTTP 400.
- `/` → HTTP 200.

Script exits 0 (PASS) only if all four assertions hold. Mirrors the
`tools/smoke-tests/*.sh` pattern (common.sh helpers, PASS/FAIL output).

### 5.3 Observability

`wrangler tail --name reckon402-agent` streamed in a second terminal while
`agent.sh` runs. At least one request log line (with URL + outcome) is
captured to the run log in commit 3.

## 6. Definition of done

- [ ] `specs/02-l1-agent-stub.md` committed (commit 1).
- [ ] `workers/agent/` tree committed (commit 2):
  - `wrangler.toml`, `package.json`, `src/index.ts`, `tsconfig.json`,
    `test/index.test.ts`, `.gitignore`
  - `pnpm --filter @reckon402/agent test` → all 3 pass.
- [ ] `wrangler deploy` succeeds; custom domain `agent.reckon402.com` is live.
- [ ] `tools/integration-tests/agent.sh` exits 0 (commit 3).
- [ ] `wrangler tail` captures at least one request log line (commit 3 run log).
- [ ] `curl https://agent.reckon402.com/research?q=test` returns 200 with
  canned JSON from a fresh terminal.
- [ ] Annotated tag `L1-deployed` created and pushed to `origin`.

## 7. Open questions

**Q-02-1** — `wrangler.toml` vs `wrangler.jsonc`: Wrangler 4.x recommends
JSONC for new projects. Disposition: TOML is fully supported in 4.40 and
is used here for consistency with the existing `tools/smoke-tests/cf-placeholder/wrangler.toml`.
Migrate to JSONC if a future Wrangler feature requires it.

**Q-02-2** — `nodejs_compat` flag: The L1 worker imports only `hono` which
has no Node built-in dependencies. Disposition: omit the flag to keep the
bundle small; add it in L2 if needed.

**Q-02-3** — CORS headers: L1 routes return JSON to local curl/browser only.
Disposition: omit CORS middleware for L1; add in L2 when the buyer SDK
makes cross-origin requests.

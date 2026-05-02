# KeeperHub Workflow Platform Publish Runbook

Source workflow: `recipes/kh-workflow.json`
Target platform: `app.keeperhub.com`

---

## Background

The `recipes/kh-workflow.json` defines a three-call sequential workflow
("Reckon402 ResearchAgent") demonstrating ERC-8004 reputation growth and
tier-based discount pricing. It must be imported into the KeeperHub platform
so judges can discover and run it from the Hub.

---

## Pre-flight

```bash
# Check KH API key is in Infisical
infisical run --env dev --domain https://secrets.intentralabs.com -- \
  bash -c 'echo "KH_API_KEY=${KH_API_KEY:0:8}…"'
```

If `KH_API_KEY` is unset, obtain it from `app.keeperhub.com → Settings →
API Keys` and push to Infisical:

```bash
~/Projects/aws_setup_2026/scripts/infisical-secret-put.sh \
  reckon402 dev KH_API_KEY <value>
```

---

## Option A — Programmatic via `kh` CLI (confirmed working 2026-05-02)

The local `kh` CLI is the canonical client. The raw HTTP API at
`api.keeperhub.com` is NOT documented in any LLM-friendly form indexed in
this repo (`LLM_friendly_tech_docs/` only contains ENS); attempting to call
guessed REST endpoints like `POST /api/workflows/create` is explicitly
out-of-scope per AGENTS.md "no guessing" guardrails. Use `kh wf` instead.

Pre-flight: `kh auth status --json` should print `method` ∈ {`token`,`apikey`}
and a non-empty `organization_id`. If not, run `kh auth login` (or set
`KH_API_KEY` and `KEEPERHUB_TOKEN` in Infisical and re-hydrate).

Two-step publish:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  # 1. Create the draft workflow.
  create_resp=$(kh workflow create \
    --name "Reckon402 ResearchAgent" \
    --description "<one paragraph + GitHub link to recipes/kh-workflow.json>" \
    --nodes "[{\"id\":\"trigger\",\"type\":\"trigger\",\"position\":{\"x\":0,\"y\":0},\"data\":{\"type\":\"trigger\",\"config\":{\"triggerType\":\"Manual\"}}}]" \
    --json)
  workflow_id=$(echo "$create_resp" | jq -r ".id")
  echo "DRAFT id=$workflow_id"

  # 2. Publish (visibility flips to "public"; URL becomes reachable without auth).
  kh workflow go-live "$workflow_id" --name "Reckon402 ResearchAgent" --json
  echo "PUBLIC_URL=https://app.keeperhub.com/workflows/$workflow_id"
'
```

Confirmed response shapes (2026-05-02):
- `kh workflow create --json` → `{id, name, createdAt}`
- `kh workflow go-live <id> --name <n> --json` → full `WorkflowDetail` with
  `visibility: "public"`, `isOwner: true`, `isListed: false`, `enabled: false`.
- Public URL pattern: `https://app.keeperhub.com/workflows/<id>` — returns
  HTTP 200 without auth and renders the workflow title in the page `<title>`.

Confirmed deviations from the user-supplied draft endpoints:
- There is NO `POST /api/workflows/create` raw HTTP form to call. The CLI
  is a single source of truth; the hosted REST surface was not indexed.
- `kh workflow create` requires `--nodes` (or `--nodes-file`) at minimum;
  it will not accept the `recipes/kh-workflow.json` shape directly because
  KH workflow nodes are `{id, type, position:{x,y}, data:{type, config}}`
  with `type`/`data.type` ∈ {`trigger`, `action`, ...}. Our recipe uses a
  custom Reckon402 schema (`type: "reckon402-buyer"`, `depends_on`, etc.)
  that does NOT correspond to any registered KH plugin (see `kh plugin ls`
  — `reckon402-buyer` is not in the catalogue). The recipe is the source
  of truth for the demo; the published KH workflow is a discovery anchor
  with a manual trigger node and a description that links back to the
  recipe on GitHub.

Schema fidelity-loss this implies (deferred):
- The published workflow has only a manual trigger node — judges who click
  "Run" on KH will not execute the three-call x402 sequence from inside
  KH's runtime. They can still read the description, click through to the
  GitHub recipe, and run `just fullflow-l4b` (or
  `tools/integration-tests/full-flow-l4b.sh`) locally for the full flow.
- A future v1.5 path: build a KH-native workflow using `System / HTTP
  Request` action nodes that hit `signing.reckon402.com/sign` then
  `agent.reckon402.com/research` with the assembled `X-Payment` header.
  Out of scope for the H-9 submission.

**Reachable failure modes observed during canary tests:**
- `kh workflow get <id> --json` for some featured templates fails with
  `decoding response: json: cannot unmarshal object into Go struct field
  WorkflowDetail.publicTags of type string` — CLI/server schema drift on
  the `publicTags` field. Does NOT affect `create` or `go-live` for
  workflows we own; only blocks `kh workflow get` against templates that
  set `publicTags`.
- `kh action get <plugin>/<slug>` is rejected with `action "..." not
  found`. Use `kh plugin get <name> --json` to list a plugin's actions
  (returns `actionType` strings like `"HTTP Request"`, not slugs).

---

## Option B — Manual UI import

1. Log in at `https://app.keeperhub.com` with the `hamiha70` account.
2. Navigate to **Builder → Workflows → New Workflow**.
3. Select **Import JSON** (or equivalent option).
4. Paste the contents of `recipes/kh-workflow.json` or upload the file.
5. In the workflow settings:
   - **Name:** `Reckon402 ResearchAgent`
   - **Price:** `0.01 USDC` (testnet price; matches canonical test amount)
   - **Network:** `base-sepolia`
   - **Environment variable** `SIGNING_WRAPPER_API_KEY`: inject from the
     KH Secrets / Environment manager (do NOT paste the plaintext key here).
     The workflow JSON references `${SIGNING_WRAPPER_API_KEY}` — KH resolves
     this at runtime from the workflow's secret store.
6. Click **Publish** / **Deploy** to make the workflow discoverable in the Hub.
7. Copy the workflow URL from the address bar or the share panel.

---

## Option C — KH skill bundle deploy (if KH supports skill manifests)

The `packages/kh-skill/` package contains a stub skill interface
(`@reckon402/kh-skill`) that exposes the Reckon402 buyer flow as a KH skill.
Once KH confirms the exact `manifest.yaml` schema, deploy via:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  pnpm --filter @reckon402/kh-skill run publish-skill \
    --api-key "$KH_API_KEY" \
    --manifest packages/kh-skill/manifest.yaml
'
```

This path is blocked until KH publishes a confirmed skill manifest schema
(open question Q-R1). The workflow JSON path (Option A / B) is the primary
demo surface for judging.

---

## Results

| Field | Value |
|-------|-------|
| KH workflow URL | `https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9` |
| KH workflow ID | `5b5bx18671fappzbchqt9` |
| Visibility | `public` (HTTP 200 without auth; page `<title>` = `Reckon402 ResearchAgent | KeeperHub`) |
| Published by | hamiha70 (org `d9dca912-bb60-41b5-a727-ee5060c2d3b1`) |
| Published at | 2026-05-02T14:24:43Z (`updatedAt` from go-live response) |
| Platform | app.keeperhub.com |
| Path used | Option A — `kh workflow create` + `kh workflow go-live` |
| Nodes published | 1 (manual trigger only — see Option A "deferred" notes) |
| Description | Full demo narrative + links to GitHub repo, recipes/kh-workflow.json, app.reckon402.com dashboard, signing.reckon402.com, on-chain factory addresses |

`AGENTS.md` `## Demo Infrastructure` "KH workflow URL" row updated in the
same commit.

---

## Verification

```bash
# 1. Anonymous HTTP probe — must return 200 and contain "Reckon402 ResearchAgent" in <title>.
curl -sS -o /tmp/kh-page.html -w "HTTP %{http_code}\n" \
  "https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9"
grep -o '<title[^>]*>[^<]*Reckon402[^<]*</title>' /tmp/kh-page.html

# 2. Authenticated round-trip via the CLI.
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  kh workflow get 5b5bx18671fappzbchqt9 --json | jq "{id,name,visibility,isOwner,enabled,nodes}"
'
```

Both probes were green at publish time (2026-05-02). If the page returns
404 or `visibility != "public"`, re-run `kh workflow go-live <id> --name
"Reckon402 ResearchAgent" --json` (idempotent).

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

## Option A — Programmatic (preferred, if KH API supports it)

The KeeperHub builder API endpoint for workflow creation was not confirmed
in available docs at the time of writing (2026-04-29). If `docs.keeperhub.com/api`
documents a `POST /workflows` or `POST /workflows/import` endpoint, use:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  curl -s -X POST "https://api.keeperhub.com/v1/workflows" \
    -H "Authorization: Bearer $KH_API_KEY" \
    -H "Content-Type: application/json" \
    -d @recipes/kh-workflow.json | tee /tmp/kh-create-result.json
  cat /tmp/kh-create-result.json
'
```

If successful, the response will contain a `workflow_id` and a public URL.
Record those in the "Results" section below and update AGENTS.md.

**Known gap:** if the KH API does not yet expose workflow creation (as of
2026-04-29), fall back to Option B.

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

## Results (fill in after publish)

| Field | Value |
|-------|-------|
| KH workflow URL | _TODO: paste after publish_ |
| KH workflow ID | _TODO_ |
| Published by | hamiha70 |
| Published at | 2026-04-29 |
| Platform | app.keeperhub.com |

After publishing, update `AGENTS.md` `## Demo Infrastructure` section with
the workflow URL.

---

## Verification

After publishing, verify the workflow appears in the Hub:

```bash
# Check workflow is discoverable via API
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  curl -s "https://api.keeperhub.com/v1/workflows?q=reckon402" \
    -H "Authorization: Bearer $KH_API_KEY" | python3 -m json.tool
'
```

Or manually browse to `https://app.keeperhub.com/hub` and search for
"Reckon402".

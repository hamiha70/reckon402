# demo.reckon402.com — Deploy Instructions

The CF API token in Infisical (`CLOUDFLARE_API_TOKEN`) is scoped to Workers only
and lacks Pages:Edit permissions. The first deploy requires a manual step.

## Step 1 — Create the Pages project (one-time, manual)

In the Cloudflare dashboard (`dash.cloudflare.com → Pages`):

1. Click **Create application → Pages → Connect to Git** OR choose
   **Direct Upload** (simpler for a static folder with no build step).
2. Project name: `reckon402-demo`
3. Build settings: no build command, output directory is `/` (single file).
4. Deploy source: `demo/` directory from this repo.

Or via CLI once a Pages-scoped token is available:

```bash
# From repo root — requires CLOUDFLARE_API_TOKEN with Pages:Edit
npx wrangler pages project create reckon402-demo --production-branch main
npx wrangler pages deploy demo/ --project-name reckon402-demo
```

## Step 2 — Add custom domain (manual, one-time)

After the first successful deploy:

1. In the Pages project settings → **Custom domains → Add domain**.
2. Enter `demo.reckon402.com`.
3. Cloudflare will add the CNAME automatically if the domain is in the
   same Cloudflare account (it is: account `0f38f8667bbcbe4f54eda13c8df009e0`).

Manual CNAME (if auto-setup fails):

```
demo.reckon402.com  CNAME  reckon402-demo.pages.dev
```

## Step 3 — Subsequent deploys (automated)

Once the project exists, the token only needs `Pages:Read` for `project list`
and `Pages:Edit` for `deploy`. If the token is upgraded:

```bash
# From repo root
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  npx wrangler pages deploy demo/ --project-name reckon402-demo
'
```

Add a `just` recipe after the first deploy:

```
deploy-demo:
    {{secrets}} bash -c 'npx wrangler pages deploy demo/ --project-name reckon402-demo'
```

## Status

- [ ] Pages project `reckon402-demo` created (manual step needed)
- [ ] `demo.reckon402.com` custom domain configured (manual step needed)
- [ ] Subsequent deploys automated via `just deploy-demo`

Update `AGENTS.md` `## Demo Infrastructure` section with the Pages project URL
and CF Pages project name once the project is created.

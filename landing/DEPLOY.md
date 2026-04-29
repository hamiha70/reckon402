# reckon402.com — Landing Page Deploy Instructions

Static HTML + Tailwind CDN. No build step. Deploy via Cloudflare Pages.

## First deploy (one-time, manual)

The CF API token in Infisical (`CLOUDFLARE_API_TOKEN`) may lack `Pages:Edit`
scope. If the CLI deploy below fails, create the project manually in the
Cloudflare dashboard and then use the CLI for subsequent deploys.

### Option A — CLI (requires Pages:Edit token)

```bash
# From repo root
npx wrangler pages project create reckon402-landing --production-branch main
npx wrangler pages deploy landing/ --project-name reckon402-landing
```

### Option B — Dashboard (manual, one-time)

1. `dash.cloudflare.com → Pages → Create application → Direct Upload`
2. Project name: `reckon402-landing`
3. Upload the `landing/` directory.
4. After deploy: Settings → Custom domains → Add `reckon402.com`

Cloudflare adds the CNAME automatically since the domain is in the same
account (`0f38f8667bbcbe4f54eda13c8df009e0`).

## Subsequent deploys

```bash
# just recipe (once project exists):
just deploy-landing
# which runs:
npx wrangler pages deploy landing/ --project-name reckon402-landing
```

Add to justfile when the project is created:
```
deploy-landing:
    npx wrangler pages deploy landing/ --project-name reckon402-landing
```

## Custom domain

`reckon402.com` → `reckon402-landing.pages.dev` (CNAME, set by Cloudflare auto-setup)

## TODO-HEADLINE

The `<!-- TODO-HEADLINE -->` placeholder in `index.html` must be replaced with
the final one-sentence pitch once the F analysis is complete. Search for
`TODO-HEADLINE` in `landing/index.html`.

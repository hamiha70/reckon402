# npm publish runbook — @reckon402/* packages

**Do NOT run `npm publish` during L2–L4 build commits.** This runbook is for
the H-9 polish window. Workspace consumption via `workspace:*` is sufficient
for the hackathon path.

## Pre-flight checklist

Before publishing any package:

- [ ] `pnpm -r run test` green from a fresh clone
- [ ] `git status` clean (no uncommitted changes)
- [ ] All `workspace:*` deps replaced with real semver ranges (see §4 below)
- [ ] npm org `reckon402` exists (`npm org ls reckon402`)
- [ ] `NPM_AUTOMATION_TOKEN` valid and not expired (expiry: 2026-07-26; stored in
  Infisical `reckon402/dev/NPM_AUTOMATION_TOKEN`)

## Publish order (dependency-first)

1. `@reckon402/types` — no @reckon402 deps; publish first
2. `@reckon402/logger` — no @reckon402 deps; publish in parallel with step 1
3. `@reckon402/buyer-sdk` — depends on `@reckon402/types`
4. `@reckon402/erc-8004-client` — no @reckon402 deps; can publish in parallel with step 3
5. `@reckon402/facilitator-client` — depends on `@reckon402/types`
6. `@reckon402/middleware-hono` — depends on `@reckon402/types`, `@reckon402/buyer-sdk`
7. `@reckon402/kh-skill` — depends on `@reckon402/types`, `@reckon402/buyer-sdk`

## Step 1 — Login (one-time per machine)

```bash
# Do NOT store the token in ~/.npmrc between commands.
# Use the environment-variable form so the token is never written to disk.
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  npm config set //registry.npmjs.org/:_authToken "$NPM_AUTOMATION_TOKEN"
'
# Verify login:
npm whoami
```

## Step 2 — Replace workspace:* dependencies

Before publishing each package, replace all `"workspace:*"` entries with the
actual published version. Edit in-place, publish, then restore for workspace use.

Example for `@reckon402/middleware-hono`:
```json
"dependencies": {
  "@reckon402/buyer-sdk": "^0.1.0",
  "@reckon402/types": "^0.1.0",
  "hono": "^4.12.0"
}
```

**Do NOT commit these replacements** — they are pre-publish-only edits.
After publish, restore `"workspace:*"` and commit the final state.

## Step 3 — Clean dist + build + test (automated via prepublishOnly)

`prepublishOnly` in each publishable package runs `rm -rf dist && pnpm run build
&& pnpm run test` before the publish step — no manual cleanup required.
The `rm -rf dist` step ensures stale artifacts from prior `tsc` runs do not
land in the tarball.

If you want to verify the builds manually without publishing:

```bash
pnpm --filter @reckon402/types run build
pnpm --filter @reckon402/buyer-sdk run build
pnpm --filter @reckon402/erc-8004-client run build
pnpm --filter @reckon402/middleware-hono run build
pnpm --filter @reckon402/facilitator-client run build
pnpm --filter @reckon402/kh-skill run build
```

## Step 4 — Publish each package

```bash
# Run inside infisical so NPM_AUTOMATION_TOKEN is in env.
# Single-quoted body: $NPM_AUTOMATION_TOKEN resolves in the Infisical child, not the outer shell.
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  npm config set //registry.npmjs.org/:_authToken "$NPM_AUTOMATION_TOKEN"

  # 1. @reckon402/types
  cd packages/types && npm publish --access public
  cd ../..

  # 2. @reckon402/logger (parallel-safe with step 1)
  cd packages/logger && npm publish --access public
  cd ../..

  # 3 (was 2). @reckon402/buyer-sdk
  cd packages/buyer-sdk && npm publish --access public
  cd ../..

  # 4. @reckon402/erc-8004-client (parallel-safe with step 3)
  cd packages/erc-8004-client && npm publish --access public
  cd ../..

  # 4. @reckon402/facilitator-client
  cd packages/facilitator-client && npm publish --access public
  cd ../..

  # 5. @reckon402/middleware-hono
  cd packages/middleware-hono && npm publish --access public
  cd ../..

  # 6. @reckon402/kh-skill
  cd packages/kh-skill && npm publish --access public
  cd ../..

  # Remove the token from ~/.npmrc immediately after all publishes.
  npm config delete //registry.npmjs.org/:_authToken
'
```

## Step 5 — Verify on registry

```bash
npm info @reckon402/types
npm info @reckon402/logger
npm info @reckon402/buyer-sdk
npm info @reckon402/facilitator-client
npm info @reckon402/erc-8004-client
npm info @reckon402/middleware-hono
npm info @reckon402/kh-skill
```

## Step 6 — Restore workspace:* deps + commit

After publishing, revert the semver replacements from Step 2 and commit:

```bash
git add packages/*/package.json
git commit -m "chore(packages): restore workspace:* after npm publish"
```

## npm package publish-readiness status (as of 2026-04-30)

Dry-run (`pnpm publish --dry-run --no-git-checks`) exits 0 for all packages below.

| Package | `license` | `publishConfig` | `prepublishOnly` (rm-rf+build+test) | `hono` peer | dry-run |
|---------|-----------|-----------------|-------------------------------------|-------------|---------|
| `@reckon402/types` | MIT | ✓ public | ✓ (build only, no tests) | n/a | ✓ 11 files |
| `@reckon402/logger` | MIT | ✓ public | ✓ (test: echo exit 0) | n/a | ✓ 3 files |
| `@reckon402/buyer-sdk` | MIT | ✓ public | ✓ 13 tests | n/a | ✓ 14 files |
| `@reckon402/facilitator-client` | MIT | ✓ public | ✓ 12 tests | n/a | ✓ 11 files |
| `@reckon402/erc-8004-client` | MIT | ✓ public | ✓ (existing) | n/a | ✓ (prior audit) |
| `@reckon402/middleware-hono` | MIT | ✓ public | ✓ 15 tests | ✓ peerDep ^4.0.0 | ✓ 8 files |
| `@reckon402/kh-skill` | MIT | ✓ public | build-only¹ | n/a | ✓ (prior audit) |

¹ `@reckon402/kh-skill` has no test suite yet (KH manifest format not final).

## Open TODOs before publish

- `@reckon402/kh-skill` manifest format: confirm `manifest.yaml` schema with KH
  docs before publishing. The KH skill contract is a stub.
- Replace `"workspace:*"` for all dependent packages (see Step 2 above).
  `pnpm publish` does this automatically — document as an alternative to manual editing.

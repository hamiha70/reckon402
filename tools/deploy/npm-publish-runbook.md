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
2. `@reckon402/buyer-sdk` — depends on `@reckon402/types`
3. `@reckon402/erc-8004-client` — no @reckon402 deps; can publish in parallel with step 2
4. `@reckon402/middleware-hono` — depends on `@reckon402/types`, `@reckon402/buyer-sdk`
5. `@reckon402/kh-skill` — depends on `@reckon402/types`, `@reckon402/buyer-sdk`

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

## Step 3 — Build + test (automated via prepublishOnly)

`prepublishOnly` in each package runs `pnpm run build && pnpm run test` before
the publish step, so manual execution is not required. If you want to verify
the build manually:

```bash
cd packages/buyer-sdk && pnpm run build
cd packages/erc-8004-client && pnpm run build
cd packages/middleware-hono && pnpm run build
cd packages/kh-skill && pnpm run build
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

  # 2. @reckon402/buyer-sdk
  cd packages/buyer-sdk && npm publish --access public
  cd ../..

  # 3. @reckon402/erc-8004-client
  cd packages/erc-8004-client && npm publish --access public
  cd ../..

  # 4. @reckon402/middleware-hono
  cd packages/middleware-hono && npm publish --access public
  cd ../..

  # 5. @reckon402/kh-skill
  cd packages/kh-skill && npm publish --access public
  cd ../..

  # Remove the token from ~/.npmrc immediately after all publishes.
  npm config delete //registry.npmjs.org/:_authToken
'
```

## Step 5 — Verify on registry

```bash
npm info @reckon402/buyer-sdk
npm info @reckon402/middleware-hono
npm info @reckon402/erc-8004-client
npm info @reckon402/kh-skill
```

## Step 6 — Restore workspace:* deps + commit

After publishing, revert the semver replacements from Step 2 and commit:

```bash
git add packages/*/package.json
git commit -m "chore(packages): restore workspace:* after npm publish"
```

## npm package publish-readiness status (as of 2026-04-29)

| Package | `name` | `version` | `description` | `main` (dist) | `types` (dist) | `repository` | `license` | `publishConfig` | `prepublishOnly` | workspace:* resolved |
|---------|--------|-----------|---------------|---------------|----------------|--------------|-----------|-----------------|-----------------|----------------------|
| `@reckon402/buyer-sdk` | ✓ | 0.1.0 | ✓ | ✓ | ✓ | ✓ | MIT | ✓ | ✓ | manual (see §2) |
| `@reckon402/erc-8004-client` | ✓ | 0.1.0 | ✓ | ✓ | ✓ | ✓ | MIT | ✓ | ✓ | n/a (no @reckon402 deps) |
| `@reckon402/middleware-hono` | ✓ | 0.1.0 | ✓ | ✓ | ✓ | ✓ | MIT | ✓ | ✓ | manual (see §2) |
| `@reckon402/kh-skill` | ✓ | 0.1.0 | ✓ | ✓ | ✓ | ✓ | MIT | ✓ | build-only¹ | manual (see §2) |

¹ `@reckon402/kh-skill` has no test suite yet (KH manifest format not final).
`prepublishOnly` runs `pnpm run build` only.

## Open TODOs before publish

- `@reckon402/types` needs to be checked for publishability separately (it is
  workspace-only today; no `publishConfig` or `build` script). Add before H-9.
- `@reckon402/kh-skill` manifest format: confirm `manifest.yaml` schema with KH
  docs before publishing. The KH skill contract is a stub.
- `@reckon402/middleware-hono` peer dependency on `hono` should be declared as
  `peerDependencies`, not `dependencies`, for cleaner consumer installs. Fix before publish.
- Replace `"workspace:*"` for `@reckon402/types` across all dependent packages
  (see Step 2 above). `pnpm publish` does this automatically with `pnpm publish --no-git-checks`
  when using pnpm workspace publish — document this as an alternative to manual editing.

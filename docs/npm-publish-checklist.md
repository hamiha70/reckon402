# npm Publish Checklist — @reckon402/* packages

Date verified: 2026-05-01

## Summary

All four packages have pre-built `dist/` directories. All dry-run packs succeed.
`npm login` is required before publishing; no token is present in the current environment.

---

## Package Status

| Package | dist/ status | Files in dist | Pack result |
|---|---|---|---|
| `@reckon402/types` | exists | 6 files (d.ts + .js) | OK — 2.3 kB tarball |
| `@reckon402/buyer-sdk` | exists | 10 files (d.ts + .js) | OK — 4.4 kB tarball |
| `@reckon402/middleware-hono` | exists | 4 files (d.ts + .js) | OK — 3.1 kB tarball |
| `@reckon402/facilitator-client` | exists | 6 files (d.ts + .js) | OK — 2.5 kB tarball |

All `dist/` directories were built on 2026-04-30. No rebuild needed.

---

## Dry-Run Output

### @reckon402/types@0.1.0

```
npm notice 📦  @reckon402/types@0.1.0
npm notice Tarball Contents
npm notice 970B  README.md
npm notice 1.7kB dist/facilitator.d.ts
npm notice 11B   dist/facilitator.js
npm notice 239B  dist/index.d.ts
npm notice 11B   dist/index.js
npm notice 1.3kB dist/x402.d.ts
npm notice 151B  dist/x402.js
npm notice 802B  package.json
npm notice 1.8kB src/facilitator.ts
npm notice 254B  src/index.ts
npm notice 1.2kB src/x402.ts
npm notice name:    @reckon402/types
npm notice version: 0.1.0
npm notice filename: reckon402-types-0.1.0.tgz
npm notice package size:  2.3 kB
npm notice unpacked size: 8.5 kB
npm notice total files:   11
```

### @reckon402/buyer-sdk@0.1.0

```
npm notice 📦  @reckon402/buyer-sdk@0.1.0
npm notice Tarball Contents
npm notice 1.7kB README.md
npm notice 715B  dist/encode.d.ts
npm notice 635B  dist/encode.js
npm notice 212B  dist/index.d.ts
npm notice 169B  dist/index.js
npm notice 999B  dist/payment-id.d.ts
npm notice 1.2kB dist/payment-id.js
npm notice 1.7kB dist/sign.d.ts
npm notice 2.6kB dist/sign.js
npm notice 1.0kB package.json
npm notice 832B  src/encode.ts
npm notice 209B  src/index.ts
npm notice 1.4kB src/payment-id.ts
npm notice 3.9kB src/sign.ts
npm notice name:    @reckon402/buyer-sdk
npm notice version: 0.1.0
npm notice filename: reckon402-buyer-sdk-0.1.0.tgz
npm notice package size:  4.4 kB
npm notice unpacked size: 17.3 kB
npm notice total files:   14
```

### @reckon402/middleware-hono@0.1.0

```
npm notice 📦  @reckon402/middleware-hono@0.1.0
npm notice Tarball Contents
npm notice 1.0kB README.md
npm notice 60B   dist/index.d.ts
npm notice 42B   dist/index.js
npm notice 1.0kB dist/withX402.d.ts
npm notice 3.8kB dist/withX402.js
npm notice 1.1kB package.json
npm notice 59B   src/index.ts
npm notice 4.3kB src/withX402.ts
npm notice name:    @reckon402/middleware-hono
npm notice version: 0.1.0
npm notice filename: reckon402-middleware-hono-0.1.0.tgz
npm notice package size:  3.1 kB
npm notice unpacked size: 11.4 kB
npm notice total files:   8
```

### @reckon402/facilitator-client@0.1.0

```
npm notice 📦  @reckon402/facilitator-client@0.1.0
npm notice Tarball Contents
npm notice 845B  README.md
npm notice 775B  dist/cdp.d.ts
npm notice 2.3kB dist/cdp.js
npm notice 98B   dist/index.d.ts
npm notice 98B   dist/index.js
npm notice 970B  dist/reckon402.d.ts
npm notice 2.7kB dist/reckon402.js
npm notice 1.0kB package.json
npm notice 2.6kB src/cdp.ts
npm notice 96B   src/index.ts
npm notice 2.8kB src/reckon402.ts
npm notice name:    @reckon402/facilitator-client
npm notice version: 0.1.0
npm notice filename: reckon402-facilitator-client-0.1.0.tgz
npm notice package size:  2.5 kB
npm notice unpacked size: 14.3 kB
npm notice total files:   11
```

---

## package.json Fields Verification

All four packages use the `publishConfig` pattern: the top-level `main`/`exports` point
to `src/` (for local monorepo workspace resolution), while `publishConfig` overrides them
to `dist/` for the published tarball. This is the correct pnpm workspace pattern.

| Package | main (published) | exports (published) | files |
|---|---|---|---|
| types | `./dist/index.js` | `{ ".": { import, types } }` | `["dist", "src"]` |
| buyer-sdk | `./dist/index.js` | `{ ".": { import, types } }` | `["dist", "src"]` |
| middleware-hono | `./dist/index.js` | `{ ".": { import, types } }` | `["dist", "src"]` |
| facilitator-client | `./dist/index.js` | `{ ".": { import, types } }` | `["dist", "src"]` |

All packages have `"license": "MIT"` and `"type": "module"`.

---

## Publish Order

Publish `types` first (it has no `@reckon402/*` dependencies). The others depend on it
and can be published in any order after.

```
NOTE: npm login is required first. No npm token is set in the current environment.
Run: npm login
Then verify with: npm whoami
```

```sh
# 1. Types (no internal deps — publish first)
cd packages/types
npm publish --access public

# 2. buyer-sdk (depends on @reckon402/types)
cd ../buyer-sdk
npm publish --access public

# 3. facilitator-client (depends on @reckon402/types)
cd ../facilitator-client
npm publish --access public

# 4. middleware-hono (depends on @reckon402/buyer-sdk + @reckon402/types)
cd ../middleware-hono
npm publish --access public
```

Or from the repo root (workspace: deps are automatically resolved from registry after types is up):

```sh
npm publish packages/types --access public
npm publish packages/buyer-sdk --access public
npm publish packages/facilitator-client --access public
npm publish packages/middleware-hono --access public
```

Note: `prepublishOnly` scripts run `rm -rf dist && pnpm run build && pnpm run test` by default.
To skip the rebuild and publish the already-built dist (recommended since builds were verified
on 2026-04-30), run from within each package directory:

```sh
# From within the package directory:
npm publish --access public --ignore-scripts
```

---

## Notes

- `@reckon402/types` has `"private": false` explicitly set — confirmed publishable.
- `@reckon402/buyer-sdk` does not set `"private"` (defaults to false) — confirmed publishable.
- `workspace:*` dependency specs in `peerDependencies`/`dependencies` are automatically
  rewritten to the actual semver range by pnpm/npm at publish time.
- No `.npmignore` files present; the `"files"` field in each `package.json` controls what
  is included: `["dist", "src"]` plus `package.json`, `README.md`, and `LICENSE` (auto-included).

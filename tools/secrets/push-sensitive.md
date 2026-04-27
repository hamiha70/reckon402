# Push a sensitive secret to Infisical (operator action)

Recipe for pushing a high-sensitivity value (private key, AWS
secret access key, KH API token, etc.) to the
`reckon402 / dev` Infisical project without ever exposing the
value through process arguments, shell history, or persistent
disk.

## Why this is its own recipe

The naive form

```bash
infisical secrets set X402COMMIT_FUNDER_PK=0xabc123…
```

leaks the secret in three places at once:

1. The shell's history file (`~/.bash_history`, `~/.zsh_history`).
2. Every audit log that captures argv (`auditd`, `bpftrace`,
   PAM session loggers, IDE telemetry, command-recording
   wrappers like `script(1)`).
3. The kernel's `/proc/<pid>/cmdline` for the lifetime of the
   `infisical` process — visible to any other user with read
   access to that file.

For ordinary config (`ENS_TEST_NAME`, `BASE_SEPOLIA_RPC_PRIMARY`,
account IDs, public addresses) the leak surface doesn't matter
— the value is non-sensitive by construction. For PKs and API
tokens, all three surfaces matter.

The pattern below avoids all three by routing the value through
a tmpfs-backed file and using Infisical's `--file` mode, which
parses dotenv-shape input over stdin rather than over argv.

## Pattern

```bash
# 1. Stage tmpfs scratch dir. /dev/shm is tmpfs on every modern
#    Linux distro (incl. WSL2) — values written here never
#    touch persistent storage. Use a per-invocation subdir so
#    parallel pushes don't collide.
SCRATCH=$(mktemp -d -p /dev/shm reckon402-secret.XXXXXX)
chmod 700 "$SCRATCH"
trap 'shred -u "$SCRATCH"/* 2>/dev/null; rmdir "$SCRATCH"' EXIT

# 2. Write the dotenv-shape file. Heredoc keeps the value out
#    of argv. Quote the heredoc terminator (<<'EOF') so the
#    shell does NOT expand $-references inside the value.
cat > "$SCRATCH/secrets.env" <<'EOF'
X402COMMIT_FUNDER_PK=0xabc123…paste here…789
X402COMMIT_FUNDER_ADDRESS=0x9AF7467EA3663F6E9cCdD4bC73bC31f537BF3F04
EOF
chmod 600 "$SCRATCH/secrets.env"

# 3. Push via Infisical's file-mode. The CLI reads the file,
#    parses each KEY=VALUE line, and uploads. Argv carries
#    only the file path — never the secret value.
infisical secrets set \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  --file "$SCRATCH/secrets.env"

# 4. EXIT trap shreds the file before deleting the dir. shred
#    overwrites the inode contents so a forensic recovery of
#    the freed tmpfs page yields zeros, not the PK.
```

## Verify the push

Read it back through the same Infisical session:

```bash
# Plain read — value lands in this terminal but is not echoed
# unless you ask. `--silent` suppresses the value display
# tooltip; `--plain` strips the human-readable framing.
infisical secrets get X402COMMIT_FUNDER_ADDRESS \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  --plain --silent

# For the *PK* itself: do NOT echo it. Round-trip via a
# checksum comparison instead — derive a deterministic shape
# fingerprint and compare to a recorded one. The simplest
# safe-shape check: hydrate via `infisical run` and confirm
# `cast wallet address` matches the public address you also
# pushed.
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- bash -c '
    derived=$(cast wallet address --private-key "$X402COMMIT_FUNDER_PK")
    expected=$X402COMMIT_FUNDER_ADDRESS
    [[ "${derived,,}" == "${expected,,}" ]] && echo "PK matches address" \
                                            || echo "PK mismatch: $derived vs $expected"
  '
```

Expected output: `PK matches address`. The verification never
prints the PK or its derived form unless they disagree.

## When to use which mode

| Secret class | Push command | Sensitivity rationale |
|---|---|---|
| Private keys (EOA, API token) | `infisical secrets set --file <tmpfs-file>` | Cannot be reissued without losing all funds / breaking flows downstream. |
| AWS secret access keys | `infisical secrets set --file <tmpfs-file>` | Reissuable, but rotation is a multi-step IAM operation. |
| RPC URLs, CLI domain, project IDs | `infisical secrets set KEY=VALUE` directly on argv | Already public-ish; the URL string itself isn't the security boundary, the rate-limit cap is. |
| Public addresses, EOA labels | Same as RPC URLs | Public by definition; written into commits anyway. |
| Sentinel / debug values (`_L0_SENTINEL`) | Same as RPC URLs | Disposable. |

Default to the file pattern when in doubt — the cost is
~30 seconds of additional ceremony and the upside is that you
never have to remember whether a particular secret made it
into a log line.

## Forward-compat: CI

When CI starts pushing rotated credentials (e.g., L4
auto-rotates the buyer-signer KMS access key on a schedule),
the same `--file` pattern applies. The CI runner mounts a
short-lived tmpfs for the dotenv file, runs `infisical secrets
set --file …`, and tears the mount down before the runner
container exits. No changes to the Infisical surface needed.

## Round 1 actuals (2026-04-27)

`X402COMMIT_FUNDER_PK` and `X402COMMIT_FUNDER_ADDRESS` were
pushed to `reckon402 / dev` via this pattern. Verification
ran clean: `derived` (from cast wallet address) matched
`X402COMMIT_FUNDER_ADDRESS`.

## See also

- The `infisical run` shell-expansion trap is documented in
  `AGENTS.md` "Secrets and hydration." When you `infisical run
  -- some-command "$KEY"`, the outer shell expands `$KEY`
  before `infisical run` injects it. Always wrap multi-step
  commands in `infisical run -- bash -c '…'` with single
  quotes so expansion happens *inside* the child process.

# ENS records on Sepolia (operator action)

Recipe for registering an ENS test name on Ethereum Sepolia and
setting / updating its records via `cast`. Captures the workflow
that closed Q-L0-1 for `reckon402-test.eth`; the same pattern
applies to any future testnet name we want to register or
re-record (text records, contenthash, additional `addr` slots
for non-ETH coin types).

## Why testnet ENS

Reckon402 resolves names via viem's `getEnsAddress` against the
`sepolia` chain object — the L0 stack proves the full
"viem -> Sepolia -> registry -> resolver -> address" path
without any mainnet ETH cost. Mainnet ENS lookups are an L4
graduation step gated on a real-world domain commitment.

## One-time: register the name

Browser action only — `app.ens.domains` runs the commit-reveal
flow more cleanly than a hand-rolled cast script. The `cast`
path costs the same gas, takes ~3 transactions and ~60 s of
wall time, and reproduces the UI flow exactly; the UI is faster
to drive once.

1. Stage signing wallet. Either:
   - import `X402COMMIT_FUNDER_PK` (or whichever PK is going to
     own the name) into MetaMask as a temporary "imported
     account"; OR
   - use any wallet you already have funded with SepETH.

   Whichever wallet signs becomes the **registry owner** of the
   name. The owner controls all records via the resolver.

2. Switch MetaMask network to **Sepolia**.

3. <https://app.ens.domains> → connect → search for the name →
   register (1-year lease is the cheapest default).

4. Three transactions: commit, register, set initial `addr()`
   record (if you let the UI set it during registration).
   Round-trip ~5 minutes including the 60-second commit-reveal
   wait imposed by the registrar.

5. After the txs land, **remove the imported account** from
   MetaMask if you imported a project PK for this op. The PK
   stays in Infisical for `cast`-driven record updates; it
   does not need to live in a browser-extension wallet beyond
   the registration itself.

## Recurring: update records via `cast`

All record writes go through the `setX(...)` family on
PublicResolver. The signer must be the registry owner of the
name (or an approved operator). Wrapped names also work, but
add a NameWrapper indirection — see "Wrapped names" below.

### Resolve the resolver address

ENS Registry on Sepolia is at the canonical multichain address:

```
0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
```

Same as mainnet. `resolver(node)` on the registry returns the
resolver address for that name; you don't need to hardcode the
default Sepolia PublicResolver because the lookup is dynamic.

```bash
unset AWS_PROFILE
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402

infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- bash -c '
    REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
    NAME=reckon402-test.eth
    NODE=$(cast namehash "$NAME")
    RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
      --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
    OWNER=$(cast call "$REGISTRY" "owner(bytes32)(address)" "$NODE" \
      --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
    echo "name      : $NAME"
    echo "node      : $NODE"
    echo "owner     : $OWNER"
    echo "resolver  : $RESOLVER"
  '
```

The owner you read out should match the address whose PK signs
the record updates below — otherwise the resolver will revert
on `setAddr` / `setText` / etc. with `Unauthorized()`.

### `setAddr` — Ethereum address (`coinType = 60`)

The classic "ENS name -> Ethereum address" record. This is
what `viem.getEnsAddress({ name })` reads.

```bash
infisical run --env dev …  -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash reckon402-test.eth)
  RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")

  cast send "$RESOLVER" "setAddr(bytes32,address)" \
    "$NODE" \
    "<NEW_TARGET_EOA>" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" \
    --private-key "$X402COMMIT_FUNDER_PK"
'
```

Replace `<NEW_TARGET_EOA>` with the address you want
the name to resolve to. Tx emits both `AddressChanged`
(multicoin form) and legacy `AddrChanged`; either event is
sufficient for off-chain indexers. Gas ~42 000.

### `setText` — string-keyed records

For `avatar`, `description`, `email`, `url`, custom keys like
`reckon402.endpoint`, etc.

```bash
infisical run --env dev …  -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash reckon402-test.eth)
  RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")

  cast send "$RESOLVER" "setText(bytes32,string,string)" \
    "$NODE" \
    "<KEY>" \
    "<VALUE>" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" \
    --private-key "$X402COMMIT_FUNDER_PK"
'
```

Standard ENSIP keys (`avatar`, `email`, `url`, `description`,
`com.twitter`, `com.github`) are recognised by ENS Manager UIs;
custom keys (`reckon402.endpoint`, `reckon402.facilitator`)
work fine for app-specific wiring and just don't render in the
ENS UI.

## Wrapped names (NameWrapper)

If you registered the name with default Manager UI settings on
ENS v2, the name may be wrapped. Detection: `registry.owner(node)`
returns the canonical Sepolia NameWrapper contract rather than
the human owner's EOA. (You can identify the NameWrapper by
cross-referencing the address against ENS deployment docs, or
just by observing that it's a contract — `cast code <addr>`
returns non-empty bytecode — whereas a human owner is an EOA.)

For wrapped names:
- The signer for `setX` calls is still the address visible as
  "manager" in app.ens.domains, *not* the NameWrapper itself.
- PublicResolver's `isAuthorised()` walks through the
  NameWrapper to verify, so the call shape is identical to
  the unwrapped path above.
- If the resolver reverts with `Unauthorized()` despite the
  signer matching the manager, the name might be in a "lock"
  state set by NameWrapper — unwrap it via the ENS Manager UI
  first.

`reckon402-test.eth` is currently **unwrapped**
(`registry.owner(node) == X402COMMIT_FUNDER_ADDRESS`), so the
direct `cast send` path works without NameWrapper detours.

## Verify the new record

`addr` readback:
```bash
infisical run --env dev …  -- bash -c '
  REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  NODE=$(cast namehash reckon402-test.eth)
  RESOLVER=$(cast call "$REGISTRY" "resolver(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY")
  cast call "$RESOLVER" "addr(bytes32)(address)" "$NODE" \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"
'
```

End-to-end via the L0 probe:
```bash
infisical run --env dev … -- ./tools/smoke-tests/ens.sh
```

Expect: `PASS ens …ms resolved=<NEW_TARGET_EOA>`.

If `ens.sh` is still PASSing on the *previous* address, double-
check that you re-ran it after the `setAddr` tx confirmed —
viem reads the resolver state at `latest`, so a freshly-mined
record propagates to the next probe instantly.

## When to re-run

This recipe runs:
- Once per new test name (replace `reckon402-test.eth` with the
  new name in every step).
- Whenever a record needs to change (e.g., we move the seller
  EOA, we add a new text record for the L1 facilitator
  endpoint).
- Never as part of a CI loop — record writes cost real gas and
  are operator-authorised actions, not automation hooks.

## Round 1 actuals (2026-04-27)

`reckon402-test.eth`:
- registered by funder `0x9AF7…3F04` (1-year lease, unwrapped)
- resolver: PublicResolver `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`
- `addr()` set to `0xD53ffac42496d73B3Faf946786688a8454F57b1f`
  (seller EOA) in tx
  [`0xd9725e9c…121d59`](https://sepolia.etherscan.io/tx/0xd9725e9c92c20be8b9788e5caae4711c63c36ef5efb7e91dcd56e4e9ed121d59)
  (block 10742776, gas 41 744).

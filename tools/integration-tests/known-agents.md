# Known ERC-8004 agents — Base Sepolia

Snapshot taken **2026-04-28** during L4a₂ implementation. Agents below are
used by the L4a₂ integration tests + `tools/integration-tests/resolve-l4a.sh
--backend erc8004` tester. Reputation state is **not promised stable** —
any agent can receive fresh feedback at any time, which moves the
summary. If a test that asserts a specific summary-count breaks, check
this file and run the snapshot command to refresh.

Registry addresses (commit `0463311492b3a7fc5fdb6990231cce721ff6cf97`):

- IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`

## Behavioral note: `getSummary` requires explicit `clientAddresses`

Design doc §7.1 suggested calling `getSummary(agentId, [], tag1, tag2)`
to get an aggregate-across-all-clients read. **Upstream does not
support that path** at this commit — the call reverts with
`"clientAddresses required"`. The library resolves this with a helper
`reputation.getSummaryForAllClients` that first calls `getClients(agentId)`
and feeds the result back into `getSummary`. See spec §12.2.1.

## Primary agent — agentId=1 (high-rep)

| Field | Value |
|-------|-------|
| agentId | `1` |
| owner | `0x21fdEd74C901129977B8e28C2588595163E1e235` |
| getAgentWallet | `0x0000000000000000000000000000000000000000` (unset) |
| tokenURI prefix | `data:application/json;base64,eyJ0eXBlIjoiaHR0cHM6Ly9laXBzLmV0aGVyZXVtLm9yZy9F…` |
| tokenURI JSON (decoded) | `{"type":"https://eips.ethereum.org/EIPS/eip-8004#registration-v1","name":"Test Agent 004 (Image Test)","x402Support":true, ...}` |
| `getClients(1)` length | 9 |
| `getSummary(1, allClients, "", "")` | count=`56`, summaryValue=`6348`, decimals=`2` |
| `getSummary(1, allClients, "payment", "x402-settlement")` | count=`0`, summaryValue=`0`, decimals=`0` (no x402-settlement-tagged feedback yet) |
| `getLastIndex(1, clients[0])` | 4 |

Interpretation: agentId=1 has substantial feedback history (56 entries)
but **none of it is tagged** `"payment"/"x402-settlement"`. Until an x402
settlement writes a tagged feedback, the pricing-tier read from the
x402 tag returns zero. For L4a₂'s demo path we read the **untagged**
summary to prove the wire is live; L4b's settle-hook will write tagged
feedbacks and the demo Act-1 narration will be driven by the
tagged-read path.

## Secondary agent — agentId=2 (low-rep, fallback surface)

| Field | Value |
|-------|-------|
| agentId | `2` |
| owner | `0x08684d223809fe810de0CCe2d232946a2bdB16C8` |
| getAgentWallet | `0x0000000000000000000000000000000000000000` (unset) |
| tokenURI | `ipfs://bafkreiffkwgvqplnbg6rev43eizpa3ldybfzb35koecyro67c6ezj5fsba` |
| `getClients(2)` length | 1 |
| `getSummary(2, allClients, "", "")` | count=`1`, summaryValue=`75`, decimals=`0` |

Use as the "low-reputation" tier in pricing-tier tests.

## Refresh command

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
REP="0x8004B663056A597Dffe9eCcC1965A193B7388713"
IDENT="0x8004A818BFB912233c491871b3d84c89A494BD9e"
RPC="$BASE_SEPOLIA_RPC_PRIMARY"
for id in 1 2; do
  echo "=== agentId=$id ==="
  owner=$(cast call "$IDENT" "ownerOf(uint256)(address)" "$id" --rpc-url "$RPC")
  clients=$(cast call "$REP" "getClients(uint256)(address[])" "$id" --rpc-url "$RPC")
  echo "owner=$owner"
  echo "clients=$clients"
  echo "summary-untagged=$(cast call "$REP" \
    "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" \
    "$id" "$clients" "" "" --rpc-url "$RPC")"
done
'
```

## Swap protocol

If agents 1 or 2 disappear (testnet reset, contract redeployment) or
their `getClients` length drops to zero:

1. Find a replacement via a sweep like the one in the refresh command
   above, extended to a larger `id` range.
2. Pick an agent with `clients.length > 0` and `ownerOf` non-zero.
3. Update the tables in this file + the integration-test fixtures
   that reference agent IDs.
4. Commit under message `docs(L4a₂): swap known-agent fixtures`.

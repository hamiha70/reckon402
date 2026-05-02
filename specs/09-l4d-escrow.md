# L4d — On-chain Escrow contract for risk-buffer release

Status: implementation in progress (Sat 2026-05-02). Cross-checked against
`specs/06-actor-act-matrix.md` D-rows; this layer adds D-row D15 below.

## Scope

Replace the off-chain "claimable USDC" accounting (L4c) with a per-agent
on-chain Escrow contract. The Escrow:

- Receives the risk-buffer slice from every settlement via a Splitter
  recipient slot (no facilitator-side state changes).
- Computes a tier-driven release fraction by reading the agent's
  ReputationRegistry feedback count (filtered by facilitator-client +
  `(payment, x402-settlement)` tags). Tier curve is parameterized at deploy
  time, not hardcoded — same Escrow code can host any monotonic
  threshold-bps schedule.
- Allows withdrawal **only** to `IdentityRegistry.ownerOf(agentId)` —
  authority follows the agent NFT. Selling/transferring the NFT
  transfers the right to claim accrued buffer.
- Tracks three counters publicly: `totalDeposited` (lifetime),
  `currentlyHeld` (now), `totalWithdrawn` (cumulative). Replay-safe: a
  withdraw cannot exceed `releasedAmount - totalWithdrawn`.

L4d ships ONLY for new onboardings (seller10+). seller9 stays on L4c
flow — full reversibility via `L4d-pre-onchain-baseline` tag.

## Actor / act / signer matrix delta (D15)

Single new on-chain act: agent owner withdraws accrued buffer.

| Field | Value |
|-------|-------|
| Actor | SellingAgent NFT owner (typically the seller EOA, but ERC-721 transferable) |
| Act | Call `Escrow.withdraw(amount)` or `withdrawAll()` |
| Signer | NFT owner's wallet (no facilitator involvement) |
| Broadcaster | NFT owner's wallet |
| Gas payer | NFT owner |
| Replay protection | On-chain: `totalWithdrawn` is monotonically increasing; withdrawal capped at `releasedAmount - totalWithdrawn` |
| Trust assumption | None for the seller. ReputationRegistry must reflect actual settlement attestations (already given by L4b1 design). |

## Contracts

Two new Solidity files under `contracts/src/`:

### `Escrow.sol`

Per-agent risk buffer. Stores no admin role. Constructor parameters
fully define behavior; no setters except the implicit `totalWithdrawn`
counter increment from `withdraw()`.

```solidity
constructor(
    IERC20  token_,                 // USDC (Base Sepolia: 0x036C…CF7e)
    address identityRegistry_,      // ERC-8004 IdentityRegistry on this chain
    address reputationRegistry_,    // ERC-8004 ReputationRegistry on this chain
    uint256 agentId_,               // immutable; binds this Escrow to one NFT
    address facilitatorClient_,     // EOA whose feedback drives the tier ramp
    uint8[]  memory tierThresholds_, // monotonically increasing attestation counts
    uint16[] memory tierReleaseBps_, // BPS each ≤ 10_000, monotonically non-decreasing
    string  memory tag1_,           // "payment"
    string  memory tag2_            // "x402-settlement"
)
```

Constructor invariants (revert otherwise):

- `tierThresholds_.length == tierReleaseBps_.length > 0`
- `tierThresholds_[i] > tierThresholds_[i-1]` for `i > 0` (strictly monotonic)
- `tierReleaseBps_[i] >= tierReleaseBps_[i-1]` for `i > 0` (non-decreasing)
- Each `tierReleaseBps_[i] <= 10_000`

Public surface:

| Function | Mutability | Purpose |
|----------|------------|---------|
| `owner() returns (address)` | view | `IIdentityRegistry(identityRegistry).ownerOf(agentId)` — authority resolver |
| `totalDeposited() returns (uint256)` | view | `currentlyHeld() + totalWithdrawn` (computed from on-chain state) |
| `currentlyHeld() returns (uint256)` | view | `token.balanceOf(address(this))` |
| `totalWithdrawn` (state var, public) | — | cumulative withdrawal counter |
| `attestationCount() returns (uint64)` | view | `getSummary(agentId, [facilitatorClient], tag1, tag2).count` |
| `releasedBps() returns (uint16)` | view | tier curve eval at current count |
| `releasedAmount() returns (uint256)` | view | `totalDeposited * releasedBps / 10_000` |
| `withdrawableNow() returns (uint256)` | view | `releasedAmount > totalWithdrawn ? releasedAmount - totalWithdrawn : 0` |
| `withdraw(uint256 amount)` | nonReentrant | owner-only; reverts if amount > available |
| `withdrawAll() returns (uint256 amount)` | nonReentrant | owner-only; pulls full `withdrawableNow()` |
| `tierConfig() returns (uint8[], uint16[], string, string)` | view | exposes tier curve for off-chain UI |
| `getStats() returns (...)` | view | dashboard helper: returns all 7 counters in one call |

Errors:

```solidity
error NotOwner();
error NothingToWithdraw();
error WithdrawAmountExceedsAvailable(uint256 requested, uint256 available);
error TierLengthsMismatch();
error TierThresholdsNotMonotonic();
error TierBpsNotMonotonic();
error TierBpsExceedsDenominator();
```

Events:

```solidity
event Withdrawn(
    address indexed by,           // == owner() at withdraw time
    uint256          amount,
    uint64           attestationCount,  // snapshot
    uint16           releasedBps        // snapshot
);
```

### `EscrowFactory.sol`

Deploys per-agent Escrows via CREATE2. Mirrors `SplitterFactory` shape so
the resolver pattern is symmetric (facilitator/dashboard can validate
"this Escrow came from us").

```solidity
constructor(
    IERC20  token_,
    address identityRegistry_,
    address reputationRegistry_
)
```

Public surface:

| Function | Purpose |
|----------|---------|
| `createEscrow(uint256 agentId, address facilitatorClient, uint8[] tierThresholds, uint16[] tierReleaseBps, string tag1, string tag2, bytes32 salt) returns (address)` | Deploy a new Escrow. Records `escrowOfAgent[agentId]` and `isDeployed[escrow]`. Reverts on duplicate agentId or duplicate salt. |
| `predictAddress(uint256 agentId, address facilitatorClient, uint8[] tierThresholds, uint16[] tierReleaseBps, string tag1, string tag2, bytes32 salt) returns (address)` | Read-only CREATE2 prediction. Used by orchestrator to pre-compute the Escrow address BEFORE deploy (so it can be wired into the Splitter's recipients[2] in the same onboarding run). |
| `isDeployed(address) returns (bool)` | mapping: was this address minted by us? |
| `escrowOfAgent(uint256 agentId) returns (address)` | mapping: which Escrow serves this agentId? |

Event:

```solidity
event EscrowCreated(
    uint256 indexed agentId,
    address indexed escrow,
    bytes32 indexed salt,
    address          facilitatorClient,
    uint8[]          tierThresholds,
    uint16[]         tierReleaseBps,
    string           tag1,
    string           tag2
);
```

Errors:

```solidity
error AlreadyDeployedForAgent(uint256 agentId);
error AlreadyDeployedAtAddress(address escrow);
error TierLengthsMismatch();
error TierThresholdsNotMonotonic();
error TierBpsNotMonotonic();
error TierBpsExceedsDenominator();
```

## Tier curve (v1 default — passed by orchestrator)

The default values mirror the L4c off-chain table. Encoded as constructor
args by the orchestrator at deploy time:

| Tier | Threshold | ReleaseBps |
|------|-----------|------------|
| T0 | 0 | 0 |
| T1 | 1 | 500 |
| T2 | 3 | 1500 |
| T3 | 10 | 3000 |
| T4 | 30 | 5000 |
| T5 | 100 | 7000 |
| T6 | 300 | 8500 |
| T7 | 1000 | 10000 |

Future agents can be onboarded with different curves without contract
changes — Escrow code is curve-agnostic.

## Onboarding order change (seller10+)

L4c order (5 steps): mint ENS → deploy Splitter → register agentId →
set ENS records → seed gateway + transfer ENS owner.

L4d order (6 steps), gated on `ENABLE_L4D_ESCROW=true`:

1. Mint ENS subname (unchanged)
2. **Register ERC-8004 agentId** (moved up — Escrow constructor needs agentId)
3. Deploy Splitter with `recipients = [sellerEoa, facilitatorFee, predictedEscrowAddr]` and `bps = [8700, 300, 1000]` (predictedEscrowAddr from `EscrowFactory.predictAddress(...)`)
4. **Deploy Escrow** at the predicted address via `EscrowFactory.createEscrow(agentId, …, salt)` (NEW step)
5. Set ENS records — adds `x402.escrow` text record alongside existing keys
6. Seed gateway + transfer ENS ownership (unchanged)

Backward compat: when `ENABLE_L4D_ESCROW=false` (default), orchestrator
follows the L4c 5-step order with `recipients[2] = facilitator EOA` (the
existing risk-buffer-EOA pattern). seller9.reckon402-test.eth permanently
on this path.

## Contract-level test plan

Forge tests under `contracts/test/Escrow.t.sol` and `EscrowFactory.t.sol`.
Target ≥20 cases covering:

**Escrow constructor:**
- Mismatched tier array lengths → `TierLengthsMismatch`
- Non-monotonic thresholds → `TierThresholdsNotMonotonic`
- Non-monotonic releaseBps → `TierBpsNotMonotonic`
- ReleaseBps > 10_000 → `TierBpsExceedsDenominator`
- Empty tier arrays → `TierLengthsMismatch`
- Valid 8-tier curve deploys cleanly

**Escrow views (with mocked IdentityRegistry + ReputationRegistry):**
- `attestationCount` reads from registry with correct args (clientAddresses, tag1, tag2)
- `releasedBps` walks tier table correctly at: count=0, count=1, count=2 (between tiers), count=3, count=29, count=30, count=999, count=1000, count=10000 (saturated)
- `totalDeposited` returns balance + totalWithdrawn
- `currentlyHeld` returns balance only
- `withdrawableNow` clamped to ≥ 0 when totalWithdrawn > releasedAmount (impossible by construction, but tested)

**Escrow withdraw — happy path:**
- Owner calls withdraw(amount) → state updates, transfer happens, event emitted
- Owner calls withdrawAll → drains withdrawableNow exactly
- Withdraw reduces `withdrawableNow` by exactly `amount`
- Subsequent withdraw at same tier returns 0 → reverts NothingToWithdraw
- Tier upgrades (e.g. count goes 9→10) unlock more withdrawal

**Escrow withdraw — rejection paths:**
- Non-owner caller → `NotOwner`
- Withdraw 0 → `NothingToWithdraw`
- Withdraw > available → `WithdrawAmountExceedsAvailable(req, avail)`
- Withdraw at T0 (count=0, releasedBps=0) → `NothingToWithdraw`
- After NFT transfer: old owner reverts NotOwner; new owner can withdraw (canonical NFT-transfer-changes-authority test)

**Reentrancy:**
- Malicious token whose transfer re-enters withdraw → revert via `nonReentrant`

**EscrowFactory:**
- `createEscrow` deploys at predicted address (CREATE2 round-trip)
- Duplicate salt for same agentId → `AlreadyDeployedAtAddress` (or `AlreadyDeployedForAgent`)
- Duplicate agentId via different salt → `AlreadyDeployedForAgent`
- Validation (tier lengths, monotonic, ≤10000) bubbled from Escrow constructor
- `predictAddress` matches `createEscrow` actual address (round-trip)
- `escrowOfAgent` and `isDeployed` populated post-deploy
- `EscrowCreated` event emitted with full args

## Deployment + migration plan

| Step | Action | Reversible? |
|------|--------|-------------|
| Tag `L4d-pre-onchain-baseline` | Created at HEAD before any work | This IS the rollback point |
| Tag `L4d-contracts-green` | All Forge tests green; no live deploy yet | Reset to baseline if compile/test issues |
| Deploy `EscrowFactory` to Base Sepolia via Foundry script (signed by deployer KMS) | Records address in AGENTS.md L4d section | Re-deploy is fine; old Escrows from previous attempts are unused |
| Tag `L4d-deployed` | Factory live, manual Escrow probe deployed + smoke-tested | Revert orchestrator to flag-off; existing seller9 unaffected |
| Orchestrator `ENABLE_L4D_ESCROW=true` (production env) | All NEW onboardings use 6-step flow | Flip back to false → falls to L4c |
| Onboard `seller10.reckon402-test.eth` | Live test seller w/ real Escrow | If broken, leave seller10 in failed state; demo seller9 |
| Tag `L4d-end-to-end-green` | Full claim flow live with MetaMask | Final demo target |

Rollback at ANY stage: `git reset --hard L4d-pre-onchain-baseline` plus
flip orchestrator flag off. seller9 stays operational throughout.

## Frontend integration (E3 — covered separately by `apps/frontend`)

When `x402.escrow` ENS record exists for the active dashboard:

- Add "Connect Wallet" button (raw `window.ethereum`, no wagmi dep)
- Read `IdentityRegistry.ownerOf(agentId)` to determine NFT owner
- If `connectedAddress === owner`: show "Claim X USDC" button calling
  `Escrow.withdraw(amount)` or `withdrawAll()`
- If connected but not owner: show "view-only — connected wallet ≠ NFT owner"
- If not connected: show "Connect to claim"
- Three counters in UI fed directly by `Escrow.getStats()` (no D1
  dependency for the on-chain numbers)

Frontend does not need to query the gateway for `x402.escrow` separately —
it can read from the same `/records/:ensName?flat=true&backend=static`
endpoint that already serves the dashboard.

## Open questions / non-goals

- **Q-09-1 (NFT-burn-recovery):** if the agent NFT is ever burned (not
  supported by current ERC-8004 IdentityRegistry but possible in
  future), `ownerOf` reverts and funds are stuck. Out of scope for
  hackathon. Mitigation in v1.5: optional fallback owner set at
  factory deploy time, callable only if `ownerOf(agentId)` reverts.
- **Q-09-2 (smart-wallet ERC-1271):** if NFT is held by a smart-wallet
  (Safe, etc.), `msg.sender == ownerOf(agentId)` works only when the
  smart-wallet calls Escrow.withdraw directly (Safe's exec). For
  EIP-1271 signature validation, would need an additional
  `withdrawWithSignature(uint256, bytes)` path. Out of scope.
- **Q-09-3 (facilitator-EOA rotation):** an Escrow's tier ramp is
  bound to one facilitatorClient EOA at deploy. Rotating the
  Reckon402 facilitator silently breaks tier progression for old
  Escrows. Mitigation in v1.5: ENS-resolved facilitatorClient (read
  at every withdraw); for now, treat as a stable address.
- **Q-09-4 (Splitter recipients[2] forgery):** anyone can deploy a
  Splitter with a Reckon402-controlled Escrow address as recipient[2]
  and route their unrelated traffic through it, padding the buffer.
  This is FINE — the Escrow's release schedule is gated on the agent's
  attestation count, so additional deposits inflate `totalDeposited`
  and accelerate the seller's claim. The "exploit" funds the seller.
- **Per-agent Escrow scaling (1 contract / 1 agent):** at 1000+ agents
  this is storage-heavy. v2 may consolidate to one Escrow with
  internal accounting per agentId. Not a hackathon issue.
- **No directory page** (`#/dashboard` listing all agents) shipped in
  L4d. Pinned as v1.5.

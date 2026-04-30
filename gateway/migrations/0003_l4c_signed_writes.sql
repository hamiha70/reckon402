-- L4c — signed-writes audit log + ENS owner cache.
-- Apply via: wrangler d1 execute reckon402-d1-gateway-dev --remote \
--              --file gateway/migrations/0003_l4c_signed_writes.sql
--
-- Spec 08B §5. No change to existing merchants / agent_id_index tables —
-- signed writes mutate merchants.records JSON in place, and this migration
-- only adds new tables.

-- Every successful signed-write call gets one row here. UNIQUE(ens_name, nonce)
-- is the replay guard: a second admin call with the same (ensName, nonce)
-- collides on insert and we return 409.
CREATE TABLE IF NOT EXISTS record_updates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ens_name      TEXT    NOT NULL,
  record_key    TEXT    NOT NULL,
  record_value  TEXT    NOT NULL,
  nonce         TEXT    NOT NULL,
  signer_addr   TEXT    NOT NULL,
  written_at    INTEGER NOT NULL,   -- unix-ms
  UNIQUE (ens_name, nonce)
);

CREATE INDEX IF NOT EXISTS idx_record_updates_ens
  ON record_updates (ens_name, written_at DESC);

-- 60s TTL cache for ENSRegistry.owner(namehash(ensName)) on Ethereum Sepolia.
-- Ownership transfer is infrequent; 60s lag is acceptable vs RPC cost on every
-- signed-write request.
CREATE TABLE IF NOT EXISTS ens_owner_cache (
  ens_name    TEXT    PRIMARY KEY,
  owner_addr  TEXT    NOT NULL,
  cached_at   INTEGER NOT NULL    -- unix-ms
);

-- D1 row used by the onboard orchestrator to track live progress for each
-- onboarding run. Polled by the frontend at GET /onboard/:id/status.
-- Each step blob is {id, label, txHash?, externalLink?, startedAt, completedAt?, error?}
-- serialized into the JSON column. No foreign keys — orchestrator owns the id space.
CREATE TABLE IF NOT EXISTS onboard_progress (
  onboard_id    TEXT    PRIMARY KEY,            -- uuid v4
  ens_name      TEXT    NOT NULL,
  seller_eoa    TEXT    NOT NULL,
  status        TEXT    NOT NULL,                -- 'running' | 'succeeded' | 'failed'
  steps_json    TEXT    NOT NULL,                -- JSON array of OnboardStep
  result_json   TEXT,                            -- JSON of OnboardResult when status != 'running'
  started_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_onboard_progress_ens
  ON onboard_progress (ens_name, started_at DESC);

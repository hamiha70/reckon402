-- L4a₂ — ERC-8004 reputation cache + agent-ID index
-- Applied per-environment via `wrangler d1 migrations apply <db> --env <env>`.

CREATE TABLE IF NOT EXISTS erc8004_cache (
  cache_key   TEXT    PRIMARY KEY,
  value_json  TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL          -- unix-ms deadline
);

CREATE INDEX IF NOT EXISTS idx_erc8004_cache_expires_at
  ON erc8004_cache (expires_at);

CREATE TABLE IF NOT EXISTS agent_id_index (
  ens_name    TEXT    PRIMARY KEY,
  chain_id    INTEGER NOT NULL,
  agent_id    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

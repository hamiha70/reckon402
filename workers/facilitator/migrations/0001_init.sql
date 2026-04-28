-- reckon402 facilitator D1 schema — L3 init
-- Source: design pack 02_facilitator.md §3 (verbatim column list).
-- At L3: receipts + recipients are INSERT-active; attestations is schema-only (L4).

CREATE TABLE IF NOT EXISTS receipts (
  payment_id        TEXT    PRIMARY KEY,
  request_id        TEXT    NOT NULL,
  state             TEXT    NOT NULL
                            CHECK (state IN ('SUBMITTED','PENDING_CONFIRMATION','CONFIRMED','RECONCILED','FAILED')),
  network           TEXT    NOT NULL,
  version           INTEGER NOT NULL
                            CHECK (version = 2),

  auth_from         TEXT    NOT NULL,
  auth_to           TEXT    NOT NULL,
  auth_value        TEXT    NOT NULL,
  auth_valid_after  INTEGER NOT NULL,
  auth_valid_before INTEGER NOT NULL,
  auth_nonce        TEXT    NOT NULL,

  "transaction"     TEXT,
  submitted_at      INTEGER NOT NULL,
  block_number      INTEGER,
  block_timestamp   INTEGER,
  confirmed_at      INTEGER,
  gas_used          TEXT,

  retry_count       INTEGER NOT NULL DEFAULT 0,
  last_retry_at     INTEGER,
  reconcile_notes   TEXT,

  failure_reason    TEXT,
  failure_detail    TEXT,

  td_erc8004_tx     TEXT,
  td_morpho_tx      TEXT,
  td_shares         TEXT,
  td_deposited_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON receipts ("transaction");
CREATE INDEX IF NOT EXISTS idx_receipts_request_id  ON receipts (request_id);
CREATE INDEX IF NOT EXISTS idx_receipts_state       ON receipts (state);
CREATE INDEX IF NOT EXISTS idx_receipts_auth_from   ON receipts (auth_from);

CREATE TABLE IF NOT EXISTS recipients (
  payment_id      TEXT    NOT NULL,
  slot            INTEGER NOT NULL,
  address         TEXT    NOT NULL,
  bps             INTEGER NOT NULL CHECK (bps >= 0 AND bps <= 10000),
  amount          TEXT    NOT NULL,
  distributed_at  INTEGER NOT NULL,
  distributed_tx  TEXT    NOT NULL,
  PRIMARY KEY (payment_id, slot),
  FOREIGN KEY (payment_id) REFERENCES receipts(payment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipients_address ON recipients (address);

-- Schema-only at L3 — L4 populates on ERC-8004 write.
CREATE TABLE IF NOT EXISTS attestations (
  payment_id        TEXT    NOT NULL,
  agent_id          INTEGER NOT NULL,
  reputation_tx     TEXT    NOT NULL,
  written_at        INTEGER NOT NULL,
  feedback_tag1     TEXT    NOT NULL,
  feedback_tag2     TEXT    NOT NULL,
  feedback_value    INTEGER NOT NULL,
  feedback_decimals INTEGER NOT NULL,
  PRIMARY KEY (payment_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_attestations_agent_id ON attestations (agent_id);

-- Healthz write-path liveness probe table.
CREATE TABLE IF NOT EXISTS _healthz_probe (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);

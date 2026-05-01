-- L4c: add SPLITTER_UNKNOWN to the receipts.state allowlist.
--
-- SQLite does not support ALTER TABLE ... MODIFY COLUMN, so we use the
-- recommended table-rebuild approach:
--   1. Rename the existing table.
--   2. Recreate it with the expanded CHECK constraint.
--   3. Copy all rows.
--   4. Drop the old table.
--   5. Recreate all indexes.
--
-- This migration is idempotent if run in a fresh DB (IF NOT EXISTS guards).
-- FOREIGN KEY enforcement is disabled during the rebuild by SQLite default
-- (foreign_keys pragma is connection-scoped and defaults OFF in D1).

PRAGMA foreign_keys = OFF;

ALTER TABLE receipts RENAME TO receipts_old;

CREATE TABLE receipts (
  payment_id        TEXT    PRIMARY KEY,
  request_id        TEXT    NOT NULL,
  state             TEXT    NOT NULL
                            CHECK (state IN ('SUBMITTED','PENDING_CONFIRMATION','CONFIRMED','RECONCILED','FAILED','SPLITTER_UNKNOWN')),
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

INSERT INTO receipts SELECT * FROM receipts_old;

DROP TABLE receipts_old;

CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON receipts ("transaction");
CREATE INDEX IF NOT EXISTS idx_receipts_request_id  ON receipts (request_id);
CREATE INDEX IF NOT EXISTS idx_receipts_state       ON receipts (state);
CREATE INDEX IF NOT EXISTS idx_receipts_auth_from   ON receipts (auth_from);

PRAGMA foreign_keys = ON;

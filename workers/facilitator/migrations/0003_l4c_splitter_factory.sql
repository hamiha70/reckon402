-- L4c: track which SplitterFactory deployment is authoritative for this
-- facilitator worker instance. Used for audit + cold-start logging.
-- No hot-path queries; written once at deploy time, read once at boot.
--
-- Also documents (in-comment only) the new 'SPLITTER_UNKNOWN' value for
-- receipts.state. SQLite has no ENUM; the column is TEXT with an allowlist
-- maintained in workers/facilitator/src/state-machine.ts (ReceiptState +
-- ALLOWED_TRANSITIONS). See specs/08a-l4c-factory-refactor.md §6.

CREATE TABLE IF NOT EXISTS deployment_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

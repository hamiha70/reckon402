-- Gateway D1 schema (L4a₁)
-- Run via: wrangler d1 execute reckon402-d1-gateway-dev --file migrations/0001_init.sql

CREATE TABLE merchants (
  ens_name    TEXT    PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 1,
  records     TEXT    NOT NULL,  -- JSON: {"x402.splitter": "0x...", "x402.facilitator": "...", ...}
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE _healthz_probe (
  k  TEXT    PRIMARY KEY,
  v  INTEGER NOT NULL
);

INSERT INTO _healthz_probe (k, v) VALUES ('ok', 1);

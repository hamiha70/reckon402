-- reckon402 facilitator D1 — L4b₁ ERC-8004 attestation writes
-- Source: specs/07-l4b-erc8004-writes.md §3.
--
-- The attestations table and receipts.td_erc8004_tx column already ship
-- with 0001_init.sql (schema-only at L3). L4b₁ flips them to
-- INSERT-active and adds a failure_detail diagnostics column so a
-- failed write (revert, RPC outage) leaves an auditable row without
-- blocking the payment response.

ALTER TABLE attestations ADD COLUMN failure_detail TEXT;

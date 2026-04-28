-- L4a₂ seed: add x402.amount to seller merchant + map it to Base Sepolia agent 1.
-- Run via `wrangler d1 execute reckon402-d1-gateway-dev --remote --file migrations/seed_l4a2.sql`.
-- Idempotent: the UPDATE is a full-row rewrite; INSERT OR IGNORE keeps existing rows.

UPDATE merchants
SET records = '{"x402.facilitator":"https://facilitator.reckon402.com","x402.splitter":"0x0ad507c6973eba86313794329ad9b12fbf24acd0","x402.endpoint":"https://agent.reckon402.com/research","x402.scheme":"eip3009","x402.version":"2","x402.asset":"eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e","x402.amount":"100000","x402.pricing":"{\"discount_bps\":0}","x402.attestation":"on","x402.yield":"none"}',
    updated_at = CAST(strftime('%s','now') * 1000 AS INTEGER)
WHERE ens_name = 'seller.reckon402-test.eth';

INSERT OR IGNORE INTO agent_id_index (ens_name, chain_id, agent_id, created_at)
VALUES ('seller.reckon402-test.eth', 84532, 1, CAST(strftime('%s','now') * 1000 AS INTEGER));

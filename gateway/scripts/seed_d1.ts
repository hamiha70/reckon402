#!/usr/bin/env node
/**
 * Seed two test merchants into the gateway D1 database.
 *
 * Run (local dev):
 *   wrangler d1 execute reckon402-d1-gateway-dev --local \
 *     --command "$(npx tsx scripts/seed_d1.ts --print-sql)"
 *
 * Run (remote):
 *   wrangler d1 execute reckon402-d1-gateway-dev \
 *     --command "$(npx tsx scripts/seed_d1.ts --print-sql)"
 *
 * Or source directly:
 *   npx tsx scripts/seed_d1.ts --print-sql | wrangler d1 execute reckon402-d1-gateway-dev --command -
 */

const NOW = Math.floor(Date.now() / 1000);

const MERCHANTS: Array<{ ens_name: string; records: Record<string, string> }> = [
  {
    ens_name: 'seller.reckon402-test.eth',
    records: {
      'x402.facilitator': 'https://facilitator.reckon402.com',
      'x402.splitter':    '0x0ad507c6973eba86313794329ad9b12fbf24acd0',
      'x402.endpoint':    'https://agent.reckon402.com/research',
      'x402.scheme':      'eip3009',
      'x402.version':     '2',
      'x402.asset':       'eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      'x402.pricing':     JSON.stringify({ discount_bps: 0 }),
      'x402.attestation': 'off',
      'x402.yield':       'none',
    },
  },
  {
    ens_name: 'search.reckon402-test.eth',
    records: {
      'x402.facilitator': 'https://facilitator.reckon402.com',
      'x402.splitter':    '0x0ad507c6973eba86313794329ad9b12fbf24acd0',
      'x402.endpoint':    'https://agent.reckon402.com/research',
      'x402.scheme':      'eip3009',
      'x402.version':     '2',
      'x402.asset':       'eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      'x402.pricing':     JSON.stringify({ discount_bps: 0 }),
      'x402.attestation': 'on',
      'x402.yield':       'none',
    },
  },
];

function buildSql(): string {
  const lines: string[] = [];
  for (const m of MERCHANTS) {
    const recordsJson = JSON.stringify(m.records).replace(/'/g, "''");
    lines.push(
      `INSERT OR REPLACE INTO merchants (ens_name, enabled, records, created_at, updated_at) ` +
      `VALUES ('${m.ens_name}', 1, '${recordsJson}', ${NOW}, ${NOW});`
    );
  }
  return lines.join('\n');
}

const args = process.argv.slice(2);
if (args.includes('--print-sql')) {
  process.stdout.write(buildSql() + '\n');
} else {
  console.error('Usage: npx tsx scripts/seed_d1.ts --print-sql');
  console.error('Then pipe to: wrangler d1 execute reckon402-d1-gateway-dev --command -');
  process.exit(1);
}

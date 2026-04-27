#!/usr/bin/env node
// check-balances.mjs — multi-chain balance snapshot for every
// reckon402 EOA + known external counterparties.
//
// Reports ETH (native gas) and USDC (per-chain Circle contract) for
// each (chain, role) cell. Output is a Markdown table per chain so
// the result is committable as a `results-<date>.md` snapshot
// without further reformatting.
//
// Usage:
//
//   unset AWS_PROFILE && \
//   infisical run --env dev \
//     --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
//     --domain https://secrets.intentralabs.com \
//     -- node tools/funding/check-balances.mjs
//
// All addresses are read either from Infisical-hydrated env
// (RECKON402_SIGNER_EOA, DEPLOYER_EOA, FACILITATOR_ADDRESS,
// SELLER_ADDRESS, BUYER_DEMO_{1,2,3}_ADDRESS) or hard-coded for
// known external parties (KeeperHub workflow wallet, x402commit
// deployer used as a Base Sepolia ETH source).
//
// RPC endpoints come from Infisical too (BASE_*_RPC_PRIMARY,
// ETH_*_RPC_PRIMARY); the script falls back to publicnode.com
// fallbacks when a primary key is missing.

import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  isAddress,
} from "viem";

// -----------------------------------------------------------------
// Chain table — id, name, RPC env keys, USDC token contract.
// -----------------------------------------------------------------

const CHAINS = [
  {
    id: 8453,
    name: "base-mainnet",
    rpcEnv: ["BASE_MAINNET_RPC_PRIMARY", "BASE_MAINNET_RPC_FALLBACK"],
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcDecimals: 6,
  },
  {
    id: 84532,
    name: "base-sepolia",
    rpcEnv: ["BASE_SEPOLIA_RPC_PRIMARY", "BASE_SEPOLIA_RPC_FALLBACK"],
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    usdcDecimals: 6,
  },
  {
    id: 1,
    name: "ethereum-mainnet",
    rpcEnv: ["ETH_MAINNET_RPC_PRIMARY", "ETH_MAINNET_RPC_FALLBACK"],
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdcDecimals: 6,
  },
  {
    id: 11155111,
    name: "ethereum-sepolia",
    rpcEnv: ["ETH_SEPOLIA_RPC_PRIMARY", "ETH_SEPOLIA_RPC_FALLBACK"],
    // Circle's testnet USDC on Ethereum Sepolia.
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    usdcDecimals: 6,
  },
];

// -----------------------------------------------------------------
// Roles. Order matches AGENTS.md "On-chain EOAs" lock table.
// -----------------------------------------------------------------

const ROLES = [
  { name: "deployer (KMS)",     env: "DEPLOYER_EOA" },
  { name: "buyer-signer (KMS)", env: "RECKON402_SIGNER_EOA" },
  { name: "facilitator",        env: "FACILITATOR_ADDRESS" },
  { name: "seller",             env: "SELLER_ADDRESS" },
  { name: "buyer-demo-1",       env: "BUYER_DEMO_1_ADDRESS" },
  { name: "buyer-demo-2",       env: "BUYER_DEMO_2_ADDRESS" },
  { name: "buyer-demo-3",       env: "BUYER_DEMO_3_ADDRESS" },
  // External — not reckon402-controlled, but tracked so we can see
  // funding-source liquidity (x402commit deployer) and KH custody
  // health (KeeperHub workflow wallet) at a glance.
  {
    name: "kh-workflow (external)",
    addr: "0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4",
  },
  {
    name: "x402commit-funder (external)",
    addr: "0x9AF7467EA3663F6E9cCdD4bC73bC31f537BF3F04",
  },
];

// -----------------------------------------------------------------
// Minimal ERC-20 balanceOf ABI fragment.
// -----------------------------------------------------------------

const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

// -----------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------

function pickRpc(chain) {
  for (const key of chain.rpcEnv) {
    const v = process.env[key];
    if (v) return { url: v, src: key };
  }
  return null;
}

function resolveAddress(role) {
  if (role.addr) return role.addr;
  if (role.env) {
    const v = process.env[role.env];
    if (v) return v;
  }
  return null;
}

function fmtEth(wei) {
  if (wei === 0n) return "0";
  // 4 decimal precision is enough to spot funding deltas at the
  // 0.001-ETH scale used by reckon402 testnet ops; trim trailing
  // zeros for readability.
  return Number(formatEther(wei)).toFixed(4).replace(/\.?0+$/, "") || "0";
}

function fmtUsdc(units, decimals) {
  if (units === 0n) return "0";
  return Number(formatUnits(units, decimals)).toFixed(2).replace(/\.?0+$/, "") || "0";
}

async function snapshotChain(chain) {
  const rpc = pickRpc(chain);
  if (!rpc) {
    return {
      chain,
      rpc: null,
      error: `no RPC URL hydrated (looked for ${chain.rpcEnv.join(", ")})`,
      rows: [],
    };
  }

  const client = createPublicClient({
    transport: http(rpc.url, { timeout: 8000, retryCount: 1 }),
  });

  const rows = [];
  for (const role of ROLES) {
    const address = resolveAddress(role);
    if (!address || !isAddress(address)) {
      rows.push({ role: role.name, address: address || "—", missing: true });
      continue;
    }
    try {
      // Two RPC calls per address. Sequential per-row keeps Alchemy
      // RPS gentle; this is a snapshot script, not a hot path.
      const [eth, usdc] = await Promise.all([
        client.getBalance({ address }),
        client.readContract({
          address: chain.usdc,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
      ]);
      rows.push({ role: role.name, address, eth, usdc });
    } catch (err) {
      rows.push({
        role: role.name,
        address,
        error: err.shortMessage || err.message || String(err),
      });
    }
  }
  return { chain, rpc, rows };
}

function renderChain(snap) {
  const lines = [];
  lines.push(`### ${snap.chain.name} (chainId ${snap.chain.id})`);
  if (snap.error) {
    lines.push("");
    lines.push(`SKIP: ${snap.error}`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push("");
  lines.push(`RPC: \`${snap.rpc.src}\``);
  lines.push("");
  lines.push(`| Role | Address | ETH | USDC |`);
  lines.push(`|------|---------|-----|------|`);
  for (const r of snap.rows) {
    if (r.missing) {
      lines.push(`| ${r.role} | _missing_ | — | — |`);
      continue;
    }
    if (r.error) {
      lines.push(`| ${r.role} | \`${r.address}\` | err | err |`);
      continue;
    }
    lines.push(
      `| ${r.role} | \`${r.address}\` | ${fmtEth(r.eth)} | ${fmtUsdc(r.usdc, snap.chain.usdcDecimals)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 19) + "Z";

  console.log(`# reckon402 — balance snapshot ${date}`);
  console.log("");
  console.log(
    "Source: `tools/funding/check-balances.mjs`. Address inputs from Infisical (`reckon402 / dev`); RPC inputs from Infisical (`*_RPC_PRIMARY`, falls back to `*_RPC_FALLBACK`).",
  );
  console.log("");

  const snaps = [];
  for (const chain of CHAINS) {
    const snap = await snapshotChain(chain);
    snaps.push(snap);
    console.log(renderChain(snap));
  }

  // Summary line: deployer ETH per chain (the funding-status focus).
  const summary = [];
  for (const snap of snaps) {
    if (snap.error) {
      summary.push(`${snap.chain.name}=skip`);
      continue;
    }
    const dep = snap.rows.find((r) => r.role.startsWith("deployer"));
    if (!dep || dep.error || dep.missing) {
      summary.push(`${snap.chain.name}=err`);
    } else {
      summary.push(`${snap.chain.name} deployer=${fmtEth(dep.eth)}eth/${fmtUsdc(dep.usdc, snap.chain.usdcDecimals)}usdc`);
    }
  }
  console.log("---");
  console.log(`snapshot ${Date.now() - t0}ms · ${summary.join(" · ")}`);
}

main().catch((err) => {
  console.error(`FAIL ${err.message || err}`);
  process.exit(1);
});

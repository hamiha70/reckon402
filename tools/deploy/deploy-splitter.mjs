// deploy-splitter.mjs — deploy the Splitter contract to Base Sepolia,
// signed by the KMS deployer EOA.
//
// Why TS-lite (.mjs): per AGENTS.md tools/* exception for one-shot CLI
// scripts. Rewrite to .ts when/if this module is imported by a production
// package.
//
// Usage (under Infisical for RPC + KMS creds):
//
//   infisical run --env dev --domain https://secrets.intentralabs.com -- \
//     bash -c 'node tools/deploy/deploy-splitter.mjs'
//
// Requires:
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = `reckon402-deployer` IAM
//     credentials (scoped to kms:Sign + kms:GetPublicKey on the deployer key).
//   AWS_REGION = eu-central-1
//   BASE_SEPOLIA_RPC_PRIMARY = Alchemy Base Sepolia URL
//   Compiled artifact at contracts/out/Splitter.sol/Splitter.json
//
// Recipients + BPS are hardcoded to the L3 demo set; change here (not
// via env) so the deploy is auditable from the commit.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, encodeAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { kmsAccount } from "../sign/kms-account.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, "..", "..");

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// L3 demo split: seller 97% / facilitator fee 2% / treasury 1%
const RECIPIENTS = [
  "0xD53ffac42496d73B3Faf946786688a8454F57b1f", // Seller
  "0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455", // Facilitator EOA (fee sink)
  "0x66C2858D9A8605957c516a77262Eb66EE6be113C", // Deployer EOA (treasury placeholder)
];
const BPS = [9700, 200, 100]; // sum = 10_000

const KEY_ALIAS = "alias/reckon402/mainnet/deployer/evm";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_PRIMARY;
  if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_PRIMARY not set (hydrate via infisical run)");

  const artifactPath = resolve(REPO_ROOT, "contracts/out/Splitter.sol/Splitter.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecode || !bytecode.startsWith("0x")) {
    throw new Error(`bytecode missing or malformed at ${artifactPath}`);
  }

  const deployer = await kmsAccount({ keyAlias: KEY_ALIAS });
  console.error(`[deploy-splitter] deployer address: ${deployer.address}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(rpcUrl) });

  // Constructor-args encoding: (address token, address[] recipients, uint16[] bps)
  const constructorArgs = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address[]" },
      { type: "uint16[]" },
    ],
    [USDC_BASE_SEPOLIA, RECIPIENTS, BPS]
  );
  const deployBytecode = bytecode + constructorArgs.slice(2);

  const balance = await publicClient.getBalance({ address: deployer.address });
  console.error(`[deploy-splitter] deployer balance: ${balance} wei (${Number(balance) / 1e18} ETH)`);
  if (balance < 10n ** 16n) {
    throw new Error(`deployer below 0.01 ETH floor on Base Sepolia; refill via x402commit-funder`);
  }

  console.error(`[deploy-splitter] sending contract-creation tx...`);
  const hash = await walletClient.sendTransaction({
    to: null,
    data: /** @type {`0x${string}`} */ (deployBytecode),
    value: 0n,
  });
  console.error(`[deploy-splitter] tx submitted: ${hash}`);
  console.error(`[deploy-splitter] waiting for receipt...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`deploy tx failed: status=${receipt.status}`);
  if (!receipt.contractAddress) throw new Error(`deploy receipt has no contractAddress`);

  const splitterAddress = receipt.contractAddress;
  console.error(`[deploy-splitter] deployed Splitter: ${splitterAddress}`);
  console.error(`[deploy-splitter] block: ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);

  // Write a deploy log the operator runbook points at.
  const logDir = resolve(REPO_ROOT, "contracts/deploy-logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const logPath = resolve(logDir, `splitter-base-sepolia-${stamp}.md`);
  const logBody = `# Splitter deploy — Base Sepolia — ${stamp}

| Field | Value |
|-------|-------|
| Splitter address | \`${splitterAddress}\` |
| Deploy tx | \`${hash}\` |
| Block | ${receipt.blockNumber} |
| Gas used | ${receipt.gasUsed} |
| Deployer | \`${deployer.address}\` (KMS \`${KEY_ALIAS}\`) |
| Token (USDC) | \`${USDC_BASE_SEPOLIA}\` |
| Recipients | ${RECIPIENTS.map((r) => `\`${r}\``).join(", ")} |
| BPS | ${BPS.join(", ")} (sum ${BPS.reduce((a, b) => a + b, 0)}) |
| Basescan | https://sepolia.basescan.org/address/${splitterAddress} |
| Basescan tx | https://sepolia.basescan.org/tx/${hash} |
`;
  writeFileSync(logPath, logBody);
  console.error(`[deploy-splitter] wrote ${logPath}`);

  // stdout = the address alone, for $(...) capture by the operator runbook.
  process.stdout.write(splitterAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

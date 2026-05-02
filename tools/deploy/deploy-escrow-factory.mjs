// deploy-escrow-factory.mjs — deploy the EscrowFactory contract to Base Sepolia,
// signed by the KMS deployer EOA.
//
// Mirrors deploy-splitter-factory.mjs. See specs/09-l4d-escrow.md and
// tools/deploy/deploy-l4d.md.
//
// Usage (under Infisical for RPC + KMS creds):
//
//   infisical run --env dev --domain https://secrets.intentralabs.com -- \
//     bash -c 'node tools/deploy/deploy-escrow-factory.mjs'
//
// Requires:
//   DEPLOYER_AWS_ACCESS_KEY_ID / DEPLOYER_AWS_SECRET_ACCESS_KEY  scoped to
//     kms:Sign + kms:GetPublicKey on the deployer key.
//   AWS_REGION = eu-central-1 (defaulted)
//   BASE_SEPOLIA_RPC_PRIMARY = Alchemy Base Sepolia URL
//   Compiled artifact at contracts/out/EscrowFactory.sol/EscrowFactory.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, encodeAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { kmsAccount } from "../sign/kms-account.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, "..", "..");

// Base Sepolia pinned addresses (canonical: AGENTS.md L3 + L4a2).
const USDC_BASE_SEPOLIA               = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const IDENTITY_REGISTRY_BASE_SEPOLIA  = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY_BASE_SEPOLIA = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const KEY_ALIAS = "alias/reckon402/mainnet/deployer/evm";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_PRIMARY;
  if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_PRIMARY not set (hydrate via infisical run)");

  // Infisical's default AWS_* slots route to the buyer-signer IAM user.
  // Switch to the deployer creds before any KMS call.
  if (process.env.DEPLOYER_AWS_ACCESS_KEY_ID) {
    process.env.AWS_ACCESS_KEY_ID     = process.env.DEPLOYER_AWS_ACCESS_KEY_ID;
    process.env.AWS_SECRET_ACCESS_KEY = process.env.DEPLOYER_AWS_SECRET_ACCESS_KEY;
    process.env.AWS_REGION            = process.env.DEPLOYER_AWS_REGION || "eu-central-1";
  }

  const artifactPath = resolve(REPO_ROOT, "contracts/out/EscrowFactory.sol/EscrowFactory.json");
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    throw new Error(`Artifact not found at ${artifactPath} - run: cd contracts && forge build`);
  }
  const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecode || !bytecode.startsWith("0x")) {
    throw new Error(`bytecode missing or malformed at ${artifactPath}`);
  }

  const deployer = await kmsAccount({ keyAlias: KEY_ALIAS });
  console.error(`[deploy-escrow-factory] deployer address: ${deployer.address}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(rpcUrl) });

  // EscrowFactory constructor: (IERC20 token, address identityRegistry, address reputationRegistry)
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [USDC_BASE_SEPOLIA, IDENTITY_REGISTRY_BASE_SEPOLIA, REPUTATION_REGISTRY_BASE_SEPOLIA]
  );
  const deployBytecode = bytecode + constructorArgs.slice(2);

  const balance = await publicClient.getBalance({ address: deployer.address });
  console.error(`[deploy-escrow-factory] deployer balance: ${Number(balance) / 1e18} ETH`);
  if (balance < 10n ** 16n) {
    throw new Error("deployer below 0.01 ETH floor on Base Sepolia");
  }

  console.error(`[deploy-escrow-factory] sending contract-creation tx...`);
  const hash = await walletClient.sendTransaction({
    to: null,
    data: /** @type {`0x${string}`} */ (deployBytecode),
    value: 0n,
  });
  console.error(`[deploy-escrow-factory] tx submitted: ${hash}`);
  console.error(`[deploy-escrow-factory] waiting for receipt...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`deploy tx failed: status=${receipt.status}`);
  if (!receipt.contractAddress) throw new Error(`deploy receipt has no contractAddress`);

  const factoryAddress = receipt.contractAddress;
  console.error(`[deploy-escrow-factory] deployed EscrowFactory: ${factoryAddress}`);
  console.error(`[deploy-escrow-factory] block: ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);

  const logDir = resolve(REPO_ROOT, "contracts/deploy-logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const logPath = resolve(logDir, `escrow-factory-base-sepolia-${stamp}.md`);
  const logBody = `# EscrowFactory deploy — Base Sepolia — ${stamp}

| Field | Value |
|-------|-------|
| EscrowFactory address | \`${factoryAddress}\` |
| Deploy tx | \`${hash}\` |
| Block | ${receipt.blockNumber} |
| Gas used | ${receipt.gasUsed} |
| Deployer | \`${deployer.address}\` (KMS \`${KEY_ALIAS}\`) |
| Token (USDC) | \`${USDC_BASE_SEPOLIA}\` |
| IdentityRegistry | \`${IDENTITY_REGISTRY_BASE_SEPOLIA}\` |
| ReputationRegistry | \`${REPUTATION_REGISTRY_BASE_SEPOLIA}\` |
| Basescan | https://sepolia.basescan.org/address/${factoryAddress} |
| Basescan tx | https://sepolia.basescan.org/tx/${hash} |
`;
  writeFileSync(logPath, logBody);
  console.error(`[deploy-escrow-factory] wrote ${logPath}`);

  // stdout = address alone, for $(...) capture in the runbook.
  process.stdout.write(factoryAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

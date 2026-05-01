// deploy-splitter-factory.mjs — deploy the SplitterFactory contract to Base Sepolia,
// signed by the KMS deployer EOA.
//
// Usage (under Infisical for RPC + KMS creds):
//
//   infisical run --env dev --domain https://secrets.intentralabs.com -- \
//     bash -c 'node tools/deploy/deploy-splitter-factory.mjs'
//
// Requires:
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = `reckon402-deployer` IAM
//     credentials (scoped to kms:Sign + kms:GetPublicKey on the deployer key).
//   AWS_REGION = eu-central-1
//   BASE_SEPOLIA_RPC_PRIMARY = Alchemy Base Sepolia URL
//   Compiled artifact at contracts/out/SplitterFactory.sol/SplitterFactory.json

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
const KEY_ALIAS = "alias/reckon402/mainnet/deployer/evm";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_PRIMARY;
  if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_PRIMARY not set (hydrate via infisical run)");

  // Build the artifact first if not present
  const artifactPath = resolve(REPO_ROOT, "contracts/out/SplitterFactory.sol/SplitterFactory.json");
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    throw new Error(`Artifact not found at ${artifactPath} — run: cd contracts && forge build`);
  }
  const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecode || !bytecode.startsWith("0x")) {
    throw new Error(`bytecode missing or malformed at ${artifactPath}`);
  }

  const deployer = await kmsAccount({ keyAlias: KEY_ALIAS });
  console.error(`[deploy-factory] deployer address: ${deployer.address}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(rpcUrl) });

  // SplitterFactory constructor: (address token)
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }],
    [USDC_BASE_SEPOLIA]
  );
  const deployBytecode = bytecode + constructorArgs.slice(2);

  const balance = await publicClient.getBalance({ address: deployer.address });
  console.error(`[deploy-factory] deployer balance: ${Number(balance) / 1e18} ETH`);
  if (balance < 10n ** 16n) {
    throw new Error("deployer below 0.01 ETH floor on Base Sepolia");
  }

  console.error(`[deploy-factory] sending contract-creation tx...`);
  const hash = await walletClient.sendTransaction({
    to: null,
    data: /** @type {`0x${string}`} */ (deployBytecode),
    value: 0n,
  });
  console.error(`[deploy-factory] tx submitted: ${hash}`);
  console.error(`[deploy-factory] waiting for receipt...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`deploy tx failed: status=${receipt.status}`);
  if (!receipt.contractAddress) throw new Error(`deploy receipt has no contractAddress`);

  const factoryAddress = receipt.contractAddress;
  console.error(`[deploy-factory] deployed SplitterFactory: ${factoryAddress}`);
  console.error(`[deploy-factory] block: ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);

  const logDir = resolve(REPO_ROOT, "contracts/deploy-logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const logPath = resolve(logDir, `splitter-factory-base-sepolia-${stamp}.md`);
  const logBody = `# SplitterFactory deploy — Base Sepolia — ${stamp}

| Field | Value |
|-------|-------|
| SplitterFactory address | \`${factoryAddress}\` |
| Deploy tx | \`${hash}\` |
| Block | ${receipt.blockNumber} |
| Gas used | ${receipt.gasUsed} |
| Deployer | \`${deployer.address}\` (KMS \`${KEY_ALIAS}\`) |
| Token (USDC) | \`${USDC_BASE_SEPOLIA}\` |
| Basescan | https://sepolia.basescan.org/address/${factoryAddress} |
| Basescan tx | https://sepolia.basescan.org/tx/${hash} |
`;
  writeFileSync(logPath, logBody);
  console.error(`[deploy-factory] wrote ${logPath}`);

  // stdout = address alone, for $(...) capture
  process.stdout.write(factoryAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

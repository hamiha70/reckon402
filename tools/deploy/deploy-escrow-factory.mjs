// deploy-escrow-factory.mjs — deploy the EscrowFactory + v1 default
// LinearMonotonicTierStrategy contracts to Base Sepolia, signed by the
// KMS deployer EOA.
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
//   Compiled artifacts at:
//     contracts/out/EscrowFactory.sol/EscrowFactory.json
//     contracts/out/LinearMonotonicTierStrategy.sol/LinearMonotonicTierStrategy.json
//
// Deploys two contracts in sequence with the same KMS-signed deployer:
//   1. LinearMonotonicTierStrategy(v1 default 8-tier curve)
//   2. EscrowFactory(token, identityRegistry, reputationRegistry)
// Prints "<factoryAddr> <strategyAddr>" to stdout for shell capture.

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
const USDC_BASE_SEPOLIA                = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const IDENTITY_REGISTRY_BASE_SEPOLIA   = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY_BASE_SEPOLIA = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const KEY_ALIAS = "alias/reckon402/mainnet/deployer/evm";

// v1 default 8-tier curve (canonical: specs/09-l4d-escrow.md).
const V1_TIER_THRESHOLDS = [0n, 1n, 3n, 10n, 30n, 100n, 300n, 1000n];
const V1_TIER_RELEASE_BPS = [0, 500, 1500, 3000, 5000, 7000, 8500, 10000];

function loadArtifact(relPath) {
  const p = resolve(REPO_ROOT, relPath);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new Error(`Artifact not found at ${p} - run: cd contracts && forge build`);
  }
  const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecode || !bytecode.startsWith("0x")) {
    throw new Error(`bytecode missing or malformed at ${p}`);
  }
  return bytecode;
}

async function deployContract({ publicClient, walletClient, deployer, name, bytecode }) {
  const balance = await publicClient.getBalance({ address: deployer.address });
  console.error(`[${name}] deployer balance: ${Number(balance) / 1e18} ETH`);
  if (balance < 10n ** 16n) {
    throw new Error(`[${name}] deployer below 0.01 ETH floor on Base Sepolia`);
  }

  console.error(`[${name}] sending contract-creation tx...`);
  const hash = await walletClient.sendTransaction({
    to: null,
    data: /** @type {`0x${string}`} */ (bytecode),
    value: 0n,
  });
  console.error(`[${name}] tx submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`[${name}] deploy tx failed: status=${receipt.status}`);
  if (!receipt.contractAddress) throw new Error(`[${name}] deploy receipt has no contractAddress`);

  console.error(`[${name}] deployed: ${receipt.contractAddress}`);
  console.error(`[${name}] block: ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);

  return {
    address: receipt.contractAddress,
    txHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

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

  const strategyBytecode = loadArtifact(
    "contracts/out/LinearMonotonicTierStrategy.sol/LinearMonotonicTierStrategy.json",
  );
  const factoryBytecode = loadArtifact(
    "contracts/out/EscrowFactory.sol/EscrowFactory.json",
  );

  const deployer = await kmsAccount({ keyAlias: KEY_ALIAS });
  console.error(`[deploy] deployer address: ${deployer.address}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account: deployer,
    chain:   baseSepolia,
    transport: http(rpcUrl),
  });

  // ─── 1) Deploy LinearMonotonicTierStrategy (v1 default 8-tier curve) ───

  const strategyConstructorArgs = encodeAbiParameters(
    [{ type: "uint64[]" }, { type: "uint16[]" }],
    [V1_TIER_THRESHOLDS, V1_TIER_RELEASE_BPS],
  );
  const strategyDeployBytecode = strategyBytecode + strategyConstructorArgs.slice(2);

  const strategy = await deployContract({
    publicClient, walletClient, deployer,
    name: "tier-strategy",
    bytecode: strategyDeployBytecode,
  });

  // ─── 2) Deploy EscrowFactory(token, identityRegistry, reputationRegistry) ───

  const factoryConstructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [USDC_BASE_SEPOLIA, IDENTITY_REGISTRY_BASE_SEPOLIA, REPUTATION_REGISTRY_BASE_SEPOLIA],
  );
  const factoryDeployBytecode = factoryBytecode + factoryConstructorArgs.slice(2);

  const factory = await deployContract({
    publicClient, walletClient, deployer,
    name: "escrow-factory",
    bytecode: factoryDeployBytecode,
  });

  // ─── 3) Write deploy log ───

  const logDir = resolve(REPO_ROOT, "contracts/deploy-logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const logPath = resolve(logDir, `escrow-factory-base-sepolia-${stamp}.md`);
  const logBody = `# EscrowFactory + LinearMonotonicTierStrategy deploy — Base Sepolia — ${stamp}

## EscrowFactory

| Field | Value |
|-------|-------|
| EscrowFactory address | \`${factory.address}\` |
| Deploy tx | \`${factory.txHash}\` |
| Block | ${factory.blockNumber} |
| Gas used | ${factory.gasUsed} |
| Deployer | \`${deployer.address}\` (KMS \`${KEY_ALIAS}\`) |
| Token (USDC) | \`${USDC_BASE_SEPOLIA}\` |
| IdentityRegistry | \`${IDENTITY_REGISTRY_BASE_SEPOLIA}\` |
| ReputationRegistry | \`${REPUTATION_REGISTRY_BASE_SEPOLIA}\` |
| Basescan | https://sepolia.basescan.org/address/${factory.address} |
| Basescan tx | https://sepolia.basescan.org/tx/${factory.txHash} |

## LinearMonotonicTierStrategy (v1 default)

| Field | Value |
|-------|-------|
| Strategy address | \`${strategy.address}\` |
| Deploy tx | \`${strategy.txHash}\` |
| Block | ${strategy.blockNumber} |
| Gas used | ${strategy.gasUsed} |
| Tier thresholds | ${JSON.stringify(V1_TIER_THRESHOLDS.map(String))} |
| Tier releaseBps | ${JSON.stringify(V1_TIER_RELEASE_BPS)} |
| Basescan | https://sepolia.basescan.org/address/${strategy.address} |
| Basescan tx | https://sepolia.basescan.org/tx/${strategy.txHash} |
`;
  writeFileSync(logPath, logBody);
  console.error(`[deploy] wrote ${logPath}`);

  // stdout = "<factoryAddr> <strategyAddr>" for $(...) capture in the runbook.
  process.stdout.write(`${factory.address} ${strategy.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

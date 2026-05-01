// seed-factory-splitter.mjs — deploy a factory Splitter for an existing SellingAgent
// and update the gateway D1 record to point at the new factory-registered address.
//
// Usage:
//   node tools/deploy/seed-factory-splitter.mjs <ensName> <sellerEoa>
//
// Example:
//   node tools/deploy/seed-factory-splitter.mjs seller.reckon402-test.eth 0xD53ffac42496d73B3Faf946786688a8454F57b1f
//
// Requires Infisical (via tools/with-secrets.sh):
//   BASE_SEPOLIA_RPC_PRIMARY, DEPLOYER_AWS_ACCESS_KEY_ID, DEPLOYER_AWS_SECRET_ACCESS_KEY
//   GATEWAY_ADMIN_TOKEN (for D1 record update)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  encodeAbiParameters,
  encodeFunctionData,
} from "viem";
import { baseSepolia } from "viem/chains";
import { kmsAccount } from "../sign/kms-account.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const FACTORY_ADDRESS = "0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const KEY_ALIAS = "alias/reckon402/mainnet/deployer/evm";
const FACILITATOR_EOA = "0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455";
const TREASURY_EOA    = "0x66C2858D9A8605957c516a77262Eb66EE6be113C";
const GATEWAY_BASE_URL = "https://gateway.reckon402.com";

// L3 split: seller 97% / facilitator fee 2% / treasury 1%
const BPS_SELLER = 9700;
const BPS_FACILITATOR = 200;
const BPS_TREASURY = 100;

const FACTORY_ABI = [
  {
    name: "createSplitter",
    type: "function",
    inputs: [
      { name: "sellingAgent", type: "address" },
      { name: "recipients",   type: "address[]" },
      { name: "bps",          type: "uint16[]" },
      { name: "salt",         type: "bytes32" },
    ],
    outputs: [{ name: "splitter", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    name: "isDeployed",
    type: "function",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
];

async function main() {
  const ensName  = process.argv[2];
  const sellerEoa = process.argv[3];
  if (!ensName || !sellerEoa) {
    throw new Error("Usage: node seed-factory-splitter.mjs <ensName> <sellerEoa>");
  }

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_PRIMARY;
  if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_PRIMARY not set");

  // Remap deployer creds (same pattern as deploy-splitter-factory.mjs)
  if (process.env.DEPLOYER_AWS_ACCESS_KEY_ID) {
    process.env.AWS_ACCESS_KEY_ID     = process.env.DEPLOYER_AWS_ACCESS_KEY_ID;
    process.env.AWS_SECRET_ACCESS_KEY = process.env.DEPLOYER_AWS_SECRET_ACCESS_KEY;
    process.env.AWS_REGION            = process.env.DEPLOYER_AWS_REGION || "eu-central-1";
  }

  const deployer = await kmsAccount({ keyAlias: KEY_ALIAS });
  console.error(`[seed-factory-splitter] deployer: ${deployer.address}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(rpcUrl) });

  const recipients = [sellerEoa, FACILITATOR_EOA, TREASURY_EOA];
  const bps        = [BPS_SELLER, BPS_FACILITATOR, BPS_TREASURY];

  // Salt = keccak256(ensName) — same convention the onboarding CLI uses
  const salt = keccak256(toBytes(ensName));
  console.error(`[seed-factory-splitter] salt: ${salt}`);
  console.error(`[seed-factory-splitter] recipients: ${recipients.join(", ")}`);
  console.error(`[seed-factory-splitter] bps: ${bps.join(", ")}`);

  // Check if already deployed
  const already = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "isDeployed",
    args: [sellerEoa], // quick check on seller EOA — won't match since it's not a splitter
  });

  const data = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createSplitter",
    args: [sellerEoa, recipients, bps, salt],
  });

  console.error(`[seed-factory-splitter] calling createSplitter on factory...`);
  const hash = await walletClient.sendTransaction({
    to: FACTORY_ADDRESS,
    data,
    value: 0n,
  });
  console.error(`[seed-factory-splitter] tx submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`createSplitter tx failed: status=${receipt.status}`);

  // Extract splitter address from SplitterCreated event (topic[2] = splitter)
  const splitterAddress = receipt.logs
    .map(l => l.topics?.[2])
    .filter(Boolean)
    .map(t => "0x" + t.slice(-40))
    .find(Boolean);

  if (!splitterAddress) throw new Error("Could not find SplitterCreated event in receipt logs");

  console.error(`[seed-factory-splitter] new Splitter: ${splitterAddress}`);
  console.error(`[seed-factory-splitter] block: ${receipt.blockNumber}`);
  console.error(`[seed-factory-splitter] Basescan: https://sepolia.basescan.org/tx/${hash}`);

  // Verify isDeployed — poll with retries to allow RPC propagation
  let deployed = false;
  for (let i = 0; i < 5; i++) {
    deployed = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "isDeployed",
      args: [splitterAddress],
    });
    if (deployed) break;
    console.error(`[seed-factory-splitter] isDeployed not yet true, waiting 3s (attempt ${i + 1}/5)...`);
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!deployed) throw new Error(`isDeployed(${splitterAddress}) returned false after retries — abort`);
  console.error(`[seed-factory-splitter] isDeployed verified: true`);

  // Print the wrangler D1 command to update the gateway record.
  // The gateway signed-writes admin route (Spec 08B) is not yet deployed;
  // the operator runs this command manually to patch the D1 row directly.
  const currentRecordsJson = JSON.stringify({ "x402.splitter": splitterAddress });
  console.error(`\n[seed-factory-splitter] --- NEXT STEP ---`);
  console.error(`Run this to update the gateway D1 x402.splitter record:`);
  console.log(`UPDATE_SQL:UPDATE merchants SET records = json_set(records, '$.\"x402.splitter\"', '${splitterAddress}') WHERE ens_name = '${ensName}'`);

  // stdout = new splitter address
  process.stdout.write(splitterAddress + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

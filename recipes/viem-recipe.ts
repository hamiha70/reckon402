/**
 * viem-recipe.ts — Pay agent.reckon402.com/research via @reckon402/buyer-sdk
 *
 * Run with:
 *   SIGNING_WRAPPER_API_KEY=<key> tsx recipes/viem-recipe.ts
 *
 * What you'll see:
 *   paymentId, state progression SUBMITTED → CONFIRMED → RECONCILED,
 *   and a final receipt object.
 */

import { reckon402 } from "@reckon402/buyer-sdk";

async function main() {
  const apiKey = process.env["SIGNING_WRAPPER_API_KEY"];
  if (!apiKey) throw new Error("SIGNING_WRAPPER_API_KEY env var not set");

  const merchantUrl = process.env["MERCHANT_URL"] ?? "https://agent.reckon402.com";
  const path = process.env["PATH_TO_GET"] ?? "/research?q=viem-recipe";

  console.log(`Paying ${merchantUrl}${path} via Reckon402 hosted signing wrapper...`);

  const receipt = await reckon402.pay({
    merchantUrl,
    path,
    amount: "0.01",
    network: "base-sepolia",
    signingClient: {
      kind: "hosted",
      url: process.env["SIGNING_URL"] ?? "https://signing.reckon402.com/sign",
      authToken: apiKey,
    },
    waitForState: "RECONCILED",
    onStateChange: (state) => console.log(`  state → ${state}`),
  });

  console.log("\nFinal receipt:");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });

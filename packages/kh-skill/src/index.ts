/**
 * @reckon402/kh-skill — KeeperHub skill: reckon402-buyer
 *
 * Thin shim over @reckon402/buyer-sdk that bridges KeeperHub workflow
 * nodes into x402 buyer flows via the hosted signing wrapper at
 * https://signing.reckon402.com/sign.
 *
 * KeeperHub's in-sandbox Turnkey wallet cannot sign EIP-712 typed-data
 * destined for HTTP bodies directly. This skill routes signing through
 * the Reckon402 hosted KMS-backed signing wrapper.
 *
 * Skill input schema:
 *   merchantUrl:  string  — HTTPS URL of the merchant endpoint
 *   path:         string  — request path (e.g., "/research")
 *   amountUsdc:   number  — payment amount in USDC decimal units (e.g., 0.01)
 *   network:      "base" | "base-sepolia"  — default "base-sepolia" for demos
 *
 * Skill output:
 *   receiptId:   string  — paymentId (0x-prefixed keccak256)
 *   tx:          string  — settlement tx hash
 *   reputation:  { count: number }  — ERC-8004 feedback count after payment
 */

export interface Reckon402SkillInput {
  merchantUrl: string;
  path: string;
  amountUsdc: number;
  network?: "base" | "base-sepolia";
}

export interface Reckon402SkillOutput {
  receiptId: string;
  tx: string;
  reputation: { count: number };
}

/**
 * Resolve the signing wrapper URL from env or use the default hosted endpoint.
 */
export function getSigningWrapperUrl(): string {
  return process.env["SIGNING_WRAPPER_URL"] ?? "https://signing.reckon402.com/sign";
}

/**
 * Skill entry point. In a real KH deployment this is invoked by the
 * KH runtime; in recipes and integration tests it is called directly.
 *
 * The actual buyer-sdk orchestration (resolve ENS, construct typed-data,
 * call signing wrapper, POST to merchant, poll receipt) happens inside
 * @reckon402/buyer-sdk's `pay()` function. This shim maps the KH skill
 * node config shape → buyer-sdk PaymentRequest shape.
 */
export async function handle(input: Reckon402SkillInput): Promise<Reckon402SkillOutput> {
  const { merchantUrl, path, amountUsdc, network = "base-sepolia" } = input;

  const signingWrapperUrl = getSigningWrapperUrl();
  const signingWrapperApiKey = process.env["SIGNING_WRAPPER_API_KEY"];

  if (!signingWrapperApiKey) {
    throw new Error("SIGNING_WRAPPER_API_KEY env var not set");
  }

  // Dynamic import to keep the skill package tree-shakeable and lightweight
  const { reckon402 } = await import("@reckon402/buyer-sdk");

  const result = await reckon402.pay({
    merchantUrl,
    path,
    amount: amountUsdc.toFixed(6),
    network,
    signingClient: {
      kind: "hosted",
      url: signingWrapperUrl,
      authToken: signingWrapperApiKey,
    },
    waitForState: "RECONCILED",
  });

  return {
    receiptId: result.paymentId,
    tx: result.transaction ?? "",
    reputation: { count: 0 },  // populated post-L4b1 by reading ERC-8004 summary
  };
}

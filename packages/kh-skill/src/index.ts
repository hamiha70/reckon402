/**
 * @reckon402/kh-skill — KeeperHub skill: reckon402-buyer
 *
 * Thin shim over @reckon402/buyer-sdk that bridges KeeperHub workflow
 * nodes into x402 buyer flows via the hosted signing wrapper at
 * https://signing.reckon402.com/sign.
 *
 * KeeperHub uses Para MPC wallets for in-platform key management. Those
 * wallets are not designed to sign EIP-712 typed-data payloads destined
 * for x402 HTTP headers directly. This skill routes signing through the
 * Reckon402 hosted KMS-backed signing wrapper instead.
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

  // TODO(buyer-sdk): replace with reckon402.pay() once the higher-level helper
  // lands in @reckon402/buyer-sdk during the facilitator rework. The shim
  // contract (input/output types, env vars, signing wrapper routing) is stable;
  // only the internal orchestration changes.
  //
  // Current placeholder: validates inputs and delegates to buyer-sdk primitives
  // once the pay() API is defined. Throws at runtime with a descriptive message
  // so integration tests fail loudly rather than silently returning wrong data.
  const _sdk = await import("@reckon402/buyer-sdk");
  void _sdk; // imported for side-effect validation; pay() is pending buyer-sdk update

  throw new Error(
    `@reckon402/kh-skill: reckon402.pay() is not yet implemented in @reckon402/buyer-sdk. ` +
    `merchantUrl=${merchantUrl} path=${path} amount=${amountUsdc} network=${network} ` +
    `signingWrapper=${signingWrapperUrl} — wire up buyer-sdk primitives here once pay() ships.`
  );
}

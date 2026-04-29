import { z } from "zod";
import { ALLOWLISTED_USDC, ALLOWED_CHAIN_IDS, MAX_VALUE } from "./allowlists.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");
const hexBytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "invalid bytes32");
const decimalString = z.string().regex(/^[0-9]+$/, "must be decimal string");

export const SignRequestSchema = z.object({
  typedData: z.object({
    domain: z.object({
      name:              z.literal("USD Coin"),
      version:           z.literal("2"),
      chainId:           z.union([z.literal(84532), z.literal(8453)]),
      verifyingContract: z.string().refine((v) => {
        // validated in handler against chainId
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      }, "invalid address"),
    }),
    types: z.object({
      TransferWithAuthorization: z.array(z.object({
        name: z.string(),
        type: z.string(),
      })).length(6, "TransferWithAuthorization must have exactly 6 fields"),
    }),
    primaryType: z.literal("TransferWithAuthorization"),
    message: z.object({
      from:        hexAddress,
      to:          hexAddress,
      value:       decimalString,
      validAfter:  decimalString,
      validBefore: decimalString,
      nonce:       hexBytes32,
    }),
  }),
  context: z.object({
    paymentId: hexBytes32.optional(),
    requestId: z.string().uuid().optional(),
  }).optional(),
});

export type SignRequest = z.infer<typeof SignRequestSchema>;

export function validateSignRequest(
  body: unknown,
  pinnedEoa: string,
  now: number,
): { ok: true; data: SignRequest } | { ok: false; code: string; message: string } {
  const parsed = SignRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: "INVALID_TYPED_DATA", message: first?.message ?? "schema validation failed" };
  }

  const { typedData } = parsed.data;
  const { domain, message } = typedData;

  // Verify verifyingContract is on allowlist for chainId
  const expected = ALLOWLISTED_USDC[domain.chainId];
  if (!expected || expected.toLowerCase() !== domain.verifyingContract.toLowerCase()) {
    return { ok: false, code: "DOMAIN_NOT_ALLOWLISTED", message: `verifyingContract not allowed for chainId ${domain.chainId}` };
  }

  // message.from must equal pinned EOA
  if (message.from.toLowerCase() !== pinnedEoa.toLowerCase()) {
    return { ok: false, code: "FROM_MISMATCH", message: `message.from must be ${pinnedEoa}` };
  }

  // value cap
  if (BigInt(message.value) > MAX_VALUE) {
    return { ok: false, code: "VALUE_TOO_LARGE", message: `value exceeds max ${MAX_VALUE}` };
  }

  // validBefore must be in the future
  if (Number(message.validBefore) <= now) {
    return { ok: false, code: "EXPIRED_VALID_BEFORE", message: "validBefore is in the past" };
  }

  return { ok: true, data: parsed.data };
}

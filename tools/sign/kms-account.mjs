// kms-account.mjs — viem LocalAccount adapter over AWS KMS.
//
// Implements specs/02-kms-signer.md. See that file for the full
// technical contract; this header captures only the runtime shape.
//
// Usage:
//
//   import { kmsAccount } from "@reckon402/sign/kms-account.mjs";
//
//   const account = await kmsAccount({
//     keyAlias: "alias/reckon402/mainnet/deployer/evm",
//     // region defaults to AWS_REGION or eu-central-1
//   });
//
//   account.address           // 0x... (derived from KMS GetPublicKey)
//   await account.signMessage({ message: "hello" })
//   await account.signTransaction({ chainId: 84532, ... })
//   await account.signTypedData({ domain, types, primaryType, message })
//
// Configuration is via the AWS SDK default credential chain. For
// reckon402, callers `export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"`
// (and same for AWS_SECRET_ACCESS_KEY) at script entry when using the
// deployer key, leaving the buyer-signer slot on AWS_ACCESS_KEY_ID for
// the existing IAM user `reckon402-signer`.
//
// Authoring policy: every line below is written from public ECDSA /
// SEC1 / EIP-2 specifications + the viem source, per AGENTS.md hard
// rule "Public OSS, fresh code only".

import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms";
import {
  hashMessage,
  hashTypedData,
  keccak256,
  recoverAddress,
  serializeTransaction,
} from "viem";

// secp256k1 curve order (RFC 5639 / SEC 2). Used for the low-S
// normalization step (s -> n - s if s > n/2). Hard-coded rather than
// imported so this module has zero runtime dependence on @noble.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N >> 1n;

// Address cache. KMS public keys are immutable for a key's lifetime,
// so caching across calls in the same Node process is safe and shaves
// one KMS round-trip per account. Keyed on `${region}|${keyAlias}` to
// disambiguate when the same alias exists in multiple regions (which
// it shouldn't for reckon402, but the cache is defensive).
/** @type {Map<string, `0x${string}`>} */
const ADDRESS_CACHE = new Map();

/**
 * Parse an X.509 SubjectPublicKeyInfo DER blob (returned by AWS KMS
 * GetPublicKey for an ECC_SECG_P256K1 key) and return the 64-byte
 * raw public key (X || Y) without the SEC1 0x04 prefix byte.
 *
 * AWS KMS always emits this in a fixed 88-byte SPKI shape:
 *   SEQUENCE(86) {
 *     SEQUENCE(16) { OID id-ecPublicKey, OID secp256k1 }
 *     BIT STRING(66) { 0x00 unused-bits, 0x04, X(32), Y(32) }
 *   }
 * The trailing 65 bytes (after the 23-byte deterministic prefix) are
 * `0x04 || X || Y`. We tail-extract and assert the 0x04 marker rather
 * than parse the full ASN.1 — the prefix is fixed by KMS so any
 * deviation indicates a wire-format change worth halting on.
 *
 * @param {Uint8Array} spkiDer
 * @returns {Uint8Array} 64-byte raw point (X || Y)
 */
function spkiToRawPubkey(spkiDer) {
  if (spkiDer.length !== 88) {
    throw new Error(
      `kms-account: unexpected SPKI length ${spkiDer.length}, expected 88 for ECC_SECG_P256K1`,
    );
  }
  if (spkiDer[23] !== 0x04) {
    throw new Error(
      `kms-account: expected uncompressed-point marker 0x04 at SPKI offset 23, got 0x${spkiDer[23].toString(16)}`,
    );
  }
  return spkiDer.slice(24); // 64 bytes: X(32) || Y(32)
}

/**
 * Parse a DER-encoded ECDSA signature into { r, s } bigints.
 *
 * Wire format (RFC 3279 / X9.62):
 *   SEQUENCE { INTEGER r, INTEGER s }
 *   = 0x30 <total-len> 0x02 <r-len> <r-bytes> 0x02 <s-len> <s-bytes>
 *
 * Both length fields use DER short-form (one byte) when total < 128
 * and long-form (0x81 <one-byte-len> or 0x82 <two-byte-len>) otherwise.
 * For secp256k1 r/s the total is always <= 72 bytes so the outer
 * length is short-form, but we handle long-form defensively.
 *
 * INTEGER values use signed-int encoding so a leading 0x00 byte may
 * be present whenever the high bit of the underlying value is set —
 * we strip it before BigInt conversion.
 *
 * @param {Uint8Array} der
 * @returns {{ r: bigint, s: bigint }}
 */
function parseDerSignature(der) {
  if (der[0] !== 0x30) {
    throw new Error("kms-account: DER signature missing SEQUENCE tag (0x30)");
  }
  // Skip the outer length field. Long-form length: top bit set on the
  // first length byte; the remaining 7 bits give the number of bytes
  // that hold the actual length value.
  let offset = 2;
  if ((der[1] & 0x80) !== 0) {
    offset = 2 + (der[1] & 0x7f);
  }

  const readInt = (start) => {
    if (der[start] !== 0x02) {
      throw new Error("kms-account: DER signature missing INTEGER tag (0x02)");
    }
    const len = der[start + 1];
    let bytes = der.slice(start + 2, start + 2 + len);
    // Strip leading 0x00 padding bytes added by the signed-int encoding.
    while (bytes.length > 1 && bytes[0] === 0x00) {
      bytes = bytes.slice(1);
    }
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return { value: BigInt("0x" + hex), nextOff: start + 2 + len };
  };

  const r = readInt(offset);
  const s = readInt(r.nextOff);
  return { r: r.value, s: s.value };
}

/** Normalize s to the lower half of the curve order (Ethereum / EIP-2). */
function normalizeLowS(s) {
  return s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
}

/**
 * Pack { r, s, v } into a 65-byte 0x-prefixed hex signature.
 * v is a single byte; for KMS-derived signatures we use yParity ∈ {0, 1}.
 */
function packSignature(r, s, v) {
  const rHex = r.toString(16).padStart(64, "0");
  const sHex = s.toString(16).padStart(64, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return /** @type {`0x${string}`} */ (`0x${rHex}${sHex}${vHex}`);
}

/**
 * Public factory: build a viem LocalAccount whose private key sits in
 * AWS KMS. See spec 02 for the contract.
 *
 * @param {{ keyAlias: string, region?: string }} opts
 * @returns {Promise<import("viem").LocalAccount>}
 */
export async function kmsAccount({ keyAlias, region }) {
  if (!keyAlias) {
    throw new Error("kmsAccount: keyAlias is required");
  }
  const resolvedRegion = region || process.env.AWS_REGION || "eu-central-1";

  const client = new KMSClient({ region: resolvedRegion });
  const cacheKey = `${resolvedRegion}|${keyAlias}`;

  // Address derivation (cached).
  let address = ADDRESS_CACHE.get(cacheKey);
  if (!address) {
    const { PublicKey } = await client.send(
      new GetPublicKeyCommand({ KeyId: keyAlias }),
    );
    if (!PublicKey) {
      throw new Error(
        `kmsAccount: KMS GetPublicKey returned no PublicKey for ${keyAlias}`,
      );
    }
    const rawPub = spkiToRawPubkey(new Uint8Array(PublicKey));
    // EIP-55 not applied here — viem normalizes addresses in its
    // recoverAddress / verifyMessage paths. We hand back a lowercase
    // address; downstream callers can checksum if they need to.
    address = /** @type {`0x${string}`} */ (
      "0x" + keccak256(rawPub).slice(-40)
    );
    ADDRESS_CACHE.set(cacheKey, address);
  }

  /**
   * Internal sign primitive: takes a 32-byte hash, returns 65-byte
   * signature with v as yParity (0 or 1).
   *
   * @param {{ hash: `0x${string}` }} param0
   * @returns {Promise<`0x${string}`>}
   */
  async function sign({ hash }) {
    if (typeof hash !== "string" || !hash.startsWith("0x") || hash.length !== 66) {
      throw new Error(
        `kmsAccount.sign: expected 0x-prefixed 32-byte hash, got ${hash}`,
      );
    }
    const hashBytes = new Uint8Array(
      hash
        .slice(2)
        .match(/.{2}/g)
        .map((b) => parseInt(b, 16)),
    );

    const { Signature } = await client.send(
      new SignCommand({
        KeyId: keyAlias,
        Message: hashBytes,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (!Signature) {
      throw new Error(`kmsAccount.sign: KMS Sign returned no Signature for ${keyAlias}`);
    }

    const { r, s: rawS } = parseDerSignature(new Uint8Array(Signature));
    const s = normalizeLowS(rawS);

    // v recovery: try yParity 0 then 1; one will recover to our address.
    // Two outcomes for a well-formed ECDSA signature; throwing past the
    // loop indicates a logic bug or a KMS protocol break.
    for (const v of [0, 1]) {
      const candidate = packSignature(r, s, v);
      const recovered = await recoverAddress({ hash, signature: candidate });
      if (recovered.toLowerCase() === address.toLowerCase()) {
        return candidate;
      }
    }
    throw new Error(
      `kmsAccount.sign: v-recovery exhausted both yParity values without matching ${address}`,
    );
  }

  return {
    address,
    type: "local",
    source: "custom",
    publicKey: undefined, // viem LocalAccount allows undefined; we don't expose pubkey bytes.
    sign,
    async signMessage({ message }) {
      return sign({ hash: hashMessage(message) });
    },
    async signTypedData(parameters) {
      return sign({ hash: hashTypedData(parameters) });
    },
    async signTransaction(transaction, options) {
      // Serialize unsigned, hash, sign, then re-serialize with the
      // signature attached so the result is broadcastable.
      const serializer = options?.serializer ?? serializeTransaction;
      const unsigned = serializer(transaction);
      const hash = keccak256(unsigned);
      const sigHex = await sign({ hash });

      const r = /** @type {`0x${string}`} */ (`0x${sigHex.slice(2, 66)}`);
      const s = /** @type {`0x${string}`} */ (`0x${sigHex.slice(66, 130)}`);
      const yParity = parseInt(sigHex.slice(130, 132), 16);
      // viem accepts yParity for typed transactions (1559/4844/7702)
      // and derives EIP-155 v from yParity + chainId for legacy txs.
      return serializer(transaction, { r, s, yParity });
    },
  };
}

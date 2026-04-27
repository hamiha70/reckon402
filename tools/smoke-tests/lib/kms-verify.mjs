#!/usr/bin/env node
/**
 * KMS sign-and-recover EOA control proof.
 *
 * Flow:
 *   1. aws kms get-public-key → parse DER SPKI → extract 65-byte
 *      uncompressed secp256k1 point.
 *   2. derivedAddress = last 20 bytes of keccak256(pubKey[1:]).
 *   3. Hash a fixed message → 32-byte digest.
 *   4. aws kms sign with MessageType=DIGEST, SigningAlgorithm=ECDSA_SHA_256.
 *   5. Parse DER signature → (r, s); normalize low-S; try v=27 and v=28
 *      via secp256k1 recovery; assert one matches derivedAddress.
 *
 * Args (env):
 *   AWS_REGION             default "eu-central-1"
 *   KMS_KEY_ALIAS          e.g. "alias/reckon402/mainnet/buyer-signer/evm"
 *   KMS_PROOF_MESSAGE      override the fixed proof string (default below)
 *
 * Exit codes:
 *   0    success — prints derivedAddress to stdout
 *   1    KMS error or recovery mismatch (diagnostic to stderr)
 *
 * Used by:
 *   tools/smoke-tests/aws.sh
 */
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

const REGION = process.env.AWS_REGION || "eu-central-1";
const ALIAS = process.env.KMS_KEY_ALIAS;
const MESSAGE = process.env.KMS_PROOF_MESSAGE
  || "reckon402 L0 ownership proof 2026-04-27";

if (!ALIAS) {
  console.error("kms-verify: KMS_KEY_ALIAS env var is required");
  process.exit(1);
}

/** Extract uncompressed secp256k1 point (65 bytes, 0x04 || X || Y) from
 *  an X.509 SubjectPublicKeyInfo DER blob. The pubkey is always the last
 *  65 bytes for secp256k1 SPKI; we sanity-check by looking for the 0x04
 *  marker rather than parsing the full ASN.1 structure. */
function extractUncompressedPubkey(spkiDer) {
  const tail = spkiDer.slice(-65);
  if (tail[0] !== 0x04) {
    throw new Error(`unexpected pubkey marker: 0x${tail[0].toString(16)}`);
  }
  return tail;
}

/** Parse DER ECDSA signature into { r, s } as BigInts. */
function parseDerSignature(der) {
  if (der[0] !== 0x30) throw new Error("DER: missing SEQUENCE tag");
  let off = 2;
  if (der[1] & 0x80) off = 2 + (der[1] & 0x7f);
  const readInt = (start) => {
    if (der[start] !== 0x02) throw new Error("DER: missing INTEGER tag");
    const len = der[start + 1];
    let bytes = der.slice(start + 2, start + 2 + len);
    while (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.slice(1);
    return { value: BigInt("0x" + bytesToHex(bytes)), nextOff: start + 2 + len };
  };
  const r = readInt(off);
  const s = readInt(r.nextOff);
  return { r: r.value, s: s.value };
}

const N = secp256k1.CURVE.n;
const HALF_N = N / 2n;

function normalizeLowS(s) {
  return s > HALF_N ? N - s : s;
}

function pubkeyToEvmAddress(uncompressed65) {
  const hash = keccak_256(uncompressed65.slice(1));
  return "0x" + bytesToHex(hash.slice(-20));
}

async function main() {
  const kms = new KMSClient({ region: REGION });

  const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId: ALIAS }));
  if (!PublicKey) throw new Error("kms:GetPublicKey returned no PublicKey");
  const uncompressed = extractUncompressedPubkey(new Uint8Array(PublicKey));
  const derivedAddress = pubkeyToEvmAddress(uncompressed);

  const digest = keccak_256(utf8ToBytes(MESSAGE));

  const { Signature } = await kms.send(
    new SignCommand({
      KeyId: ALIAS,
      Message: digest,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }),
  );
  if (!Signature) throw new Error("kms:Sign returned no Signature");

  const { r, s: rawS } = parseDerSignature(new Uint8Array(Signature));
  const s = normalizeLowS(rawS);

  const sigCompact = hexToBytes(
    r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0"),
  );

  let recovered = null;
  for (const recoveryBit of [0, 1]) {
    try {
      const sig = secp256k1.Signature.fromCompact(sigCompact)
        .addRecoveryBit(recoveryBit);
      const recoveredPubkey = sig.recoverPublicKey(digest).toRawBytes(false);
      const candidate = pubkeyToEvmAddress(recoveredPubkey);
      if (candidate.toLowerCase() === derivedAddress.toLowerCase()) {
        recovered = { recoveryBit, address: candidate };
        break;
      }
    } catch (err) {
      // Try the other recovery bit.
    }
  }

  if (!recovered) {
    console.error(`kms-verify: signature recovered to no candidate matching ${derivedAddress}`);
    process.exit(1);
  }

  console.log(derivedAddress);
}

main().catch((err) => {
  console.error(`kms-verify: ${err.message || err}`);
  process.exit(1);
});

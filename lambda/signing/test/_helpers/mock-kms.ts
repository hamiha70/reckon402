// Mock KMS client that signs locally using a hardcoded secp256k1 test key.
// Used only in unit tests — never imported by production code.

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { recoverAddress, type Hex } from "viem";
import { parseDerSignature, parseDerSpki } from "../../src/kms/der.js";

// A deterministic test private key (not used on any real chain).
export const TEST_PRIVATE_KEY = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const;

export const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

/**
 * Build a fake DER SubjectPublicKeyInfo for the given uncompressed 65-byte EC point.
 * Structure: SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING { 0x00, point } }
 */
export function buildFakeSpkiDer(uncompressedPoint: Uint8Array): Uint8Array {
  // Minimal DER SPKI for secp256k1 uncompressed key
  // Inner alg SEQUENCE (fixed for secp256k1): 13 bytes
  const algSeq = Buffer.from([
    0x30, 0x0e,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID ecPublicKey
    0x06, 0x03, 0x2b, 0x81, 0x04, 0x00, 0x0a,              // OID secp256k1
  ]);
  // Actually let's correct: 0x30 0x0e = 14 bytes of content
  // ecPublicKey OID: 1.2.840.10045.2.1  → 06 07 2a 86 48 ce 3d 02 01
  // secp256k1 OID:   1.3.132.0.10       → 06 05 2b 81 04 00 0a
  const correctAlgSeq = Buffer.from([
    0x30, 0x10,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a,
  ]);
  const bitString = Buffer.concat([
    Buffer.from([0x03, 0x42, 0x00]),  // BIT STRING, 66 bytes, 0 unused bits
    uncompressedPoint,
  ]);
  const inner = Buffer.concat([correctAlgSeq, bitString]);
  const outer = Buffer.concat([
    Buffer.from([0x30, inner.length]),
    inner,
  ]);
  return outer;
}

/**
 * Build a DER-encoded ECDSA signature from r and s.
 * Used to simulate what KMS returns.
 */
export function buildDerSignature(r: bigint, s: bigint): Uint8Array {
  function encodeInt(n: bigint): Buffer {
    const hex = n.toString(16).padStart(64, "0");
    const bytes = Buffer.from(hex, "hex");
    // prepend 0x00 if high bit set (to preserve sign)
    return bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0x00]), bytes]) : bytes;
  }

  const rEnc = encodeInt(r);
  const sEnc = encodeInt(s);

  const rTlv = Buffer.concat([Buffer.from([0x02, rEnc.length]), rEnc]);
  const sTlv = Buffer.concat([Buffer.from([0x02, sEnc.length]), sEnc]);
  const inner = Buffer.concat([rTlv, sTlv]);
  return Buffer.concat([Buffer.from([0x30, inner.length]), inner]);
}

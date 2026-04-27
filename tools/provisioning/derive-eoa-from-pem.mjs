#!/usr/bin/env node
// derive-eoa-from-pem.mjs — derive an Ethereum EOA from a SEC1
// SubjectPublicKeyInfo (DER, PEM-wrapped) public key produced by
// `aws kms get-public-key` for an ECC_SECG_P256K1 key.
//
// This is the OFFLINE counterpart to lib/kms-verify.mjs (which calls
// AWS KMS Sign + recovers v). Given only the published PEM, anyone
// can reproduce the EOA without AWS access.
//
// Usage:
//   node derive-eoa-from-pem.mjs <path/to/key.pem>
//
// Exit code 0 + EOA on stdout on success.

import { readFileSync } from "node:fs";
import { keccak_256 } from "@noble/hashes/sha3";

const path = process.argv[2];
if (!path) {
  console.error("usage: derive-eoa-from-pem.mjs <pem-file>");
  process.exit(2);
}

const pem = readFileSync(path, "utf8");
const b64 = pem
  .replace(/-----BEGIN PUBLIC KEY-----/g, "")
  .replace(/-----END PUBLIC KEY-----/g, "")
  .replace(/\s+/g, "");
const der = Buffer.from(b64, "base64");

// SubjectPublicKeyInfo for ECC_SECG_P256K1 from AWS KMS:
//   30 56                                       SEQUENCE (86 bytes)
//     30 10                                     SEQUENCE (16 bytes) AlgorithmIdentifier
//       06 07 2A 86 48 CE 3D 02 01              OID id-ecPublicKey
//       06 05 2B 81 04 00 0A                    OID secp256k1
//     03 42 00                                  BIT STRING (66 bytes; 0 unused bits)
//       04 <X 32 bytes> <Y 32 bytes>            uncompressed point
//
// Total prefix before the uncompressed point: 24 bytes; the point is
// 65 bytes (1 byte 0x04 || 32 X || 32 Y); we strip the leading 0x04.

if (der.length !== 88) {
  throw new Error(
    `unexpected DER length ${der.length}, want 88 for ECC_SECG_P256K1 SPKI`,
  );
}
const expectedPrefix = Buffer.from(
  "3056301006072a8648ce3d020106052b8104000a034200",
  "hex",
);
if (!der.subarray(0, 23).equals(expectedPrefix)) {
  throw new Error("DER prefix does not match secp256k1 SPKI template");
}
if (der[23] !== 0x04) {
  throw new Error(
    "expected 0x04 (uncompressed point marker) at offset 23",
  );
}
const xy = der.subarray(24); // 64 bytes
if (xy.length !== 64) {
  throw new Error(`unexpected XY length ${xy.length}, want 64`);
}

const hash = keccak_256(xy);
const addr = "0x" + Buffer.from(hash.slice(-20)).toString("hex");
process.stdout.write(addr + "\n");

// DER parsing utilities for AWS KMS outputs.

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) {
    result = (result << 8n) | BigInt(b);
  }
  return result;
}

/**
 * Parse DER SubjectPublicKeyInfo → 65-byte uncompressed EC point (0x04 || X || Y).
 * KMS GetPublicKey returns SPKI DER: SEQUENCE { SEQUENCE { OID, OID }, BIT STRING }.
 */
export function parseDerSpki(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("DER_SPKI: outer not SEQUENCE");

  // Skip outer SEQUENCE tag + length
  let i = 1;
  let outerLen: number;
  if ((der[i] & 0x80) !== 0) {
    const lenBytes = der[i] & 0x7f;
    i += 1 + lenBytes;
  } else {
    i += 1;
  }

  // Skip inner SEQUENCE (algorithm identifier)
  if (der[i] !== 0x30) throw new Error("DER_SPKI: algorithm SEQUENCE missing");
  i += 1;
  if ((der[i] & 0x80) !== 0) {
    const lenBytes = der[i] & 0x7f;
    const algLen = Number(bytesToBigInt(der.slice(i + 1, i + 1 + lenBytes)));
    i += 1 + lenBytes + algLen;
  } else {
    const algLen = der[i];
    i += 1 + algLen;
  }

  // BIT STRING
  if (der[i] !== 0x03) throw new Error("DER_SPKI: BIT STRING missing");
  i += 1;
  // Length (may be 2 bytes for 66)
  let bsLen: number;
  if ((der[i] & 0x80) !== 0) {
    const lenBytes = der[i] & 0x7f;
    bsLen = Number(bytesToBigInt(der.slice(i + 1, i + 1 + lenBytes)));
    i += 1 + lenBytes;
  } else {
    bsLen = der[i];
    i += 1;
  }
  // Skip unused-bits indicator byte
  i += 1;

  const point = der.slice(i, i + 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(`DER_SPKI: expected 65-byte uncompressed point, got ${point.length} bytes, prefix=0x${point[0]?.toString(16)}`);
  }
  return point;
}

/**
 * Parse DER SEQUENCE { r INTEGER, s INTEGER } returned by KMS Sign.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error("DER_SIG: not SEQUENCE");
  let i = 2;
  if ((der[1] & 0x80) !== 0) i = 2 + (der[1] & 0x7f);

  if (der[i] !== 0x02) throw new Error("DER_SIG: r not INTEGER");
  const rLen = der[i + 1]!;
  const rSlice = der.slice(i + 2, i + 2 + rLen);
  const r = bytesToBigInt(rSlice[0] === 0x00 ? rSlice.slice(1) : rSlice);
  i += 2 + rLen;

  if (der[i] !== 0x02) throw new Error("DER_SIG: s not INTEGER");
  const sLen = der[i + 1]!;
  const sSlice = der.slice(i + 2, i + 2 + sLen);
  const s = bytesToBigInt(sSlice[0] === 0x00 ? sSlice.slice(1) : sSlice);

  return { r, s };
}

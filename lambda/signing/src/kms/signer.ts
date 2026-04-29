import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { keccak256, recoverAddress, type Hex } from "viem";
import { parseDerSpki, parseDerSignature } from "./der.js";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function normalizeLowS(s: bigint): bigint {
  return s > SECP256K1_N >> 1n ? SECP256K1_N - s : s;
}

function encodeRsv(r: bigint, s: bigint, v: 27 | 28): Hex {
  const rHex = r.toString(16).padStart(64, "0");
  const sHex = s.toString(16).padStart(64, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${rHex}${sHex}${vHex}` as Hex;
}

function recoverV(digest: Hex, r: bigint, s: bigint, expected: Hex): 27 | 28 {
  for (const v of [27, 28] as const) {
    const sig = encodeRsv(r, s, v);
    const recovered = recoverAddress({ hash: digest, signature: sig });
    if (recovered.toLowerCase() === expected.toLowerCase()) return v;
  }
  throw new Error("V_RECOVERY_FAILED: neither v=27 nor v=28 recovers the expected EOA");
}

export class KmsSigner {
  private client: KMSClient;
  private keyId: string;
  private pinnedEoa: Hex | null = null;

  constructor(keyId: string, region: string) {
    this.client = new KMSClient({ region });
    this.keyId = keyId;
  }

  async getEoa(): Promise<Hex> {
    if (this.pinnedEoa !== null) return this.pinnedEoa;

    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!out.PublicKey) throw new Error("KMS: no public key returned");

    const point = parseDerSpki(Buffer.from(out.PublicKey));
    const xy = point.slice(1);  // 64 bytes: X || Y
    const hash = keccak256(xy as Uint8Array);
    this.pinnedEoa = `0x${hash.slice(-40)}` as Hex;
    return this.pinnedEoa;
  }

  async sign(digest: Hex): Promise<Hex> {
    const eoa = await this.getEoa();
    const digestBytes = Buffer.from(digest.slice(2), "hex");

    const out = await this.client.send(new SignCommand({
      KeyId: this.keyId,
      Message: digestBytes,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }));

    if (!out.Signature) throw new Error("KMS: no signature returned");

    const { r, s: rawS } = parseDerSignature(Buffer.from(out.Signature));
    const s = normalizeLowS(rawS);
    const v = recoverV(digest, r, s, eoa);

    return encodeRsv(r, s, v);
  }
}

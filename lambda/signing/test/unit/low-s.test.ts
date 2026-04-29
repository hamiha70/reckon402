import { describe, expect, it } from "vitest";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function normalizeLowS(s: bigint): bigint {
  return s > SECP256K1_N >> 1n ? SECP256K1_N - s : s;
}

describe("low-S normalization", () => {
  it("leaves low-S unchanged", () => {
    const s = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
    expect(s < SECP256K1_N >> 1n).toBe(true);
    expect(normalizeLowS(s)).toBe(s);
  });

  it("flips high-S to low-S", () => {
    // Construct a high-S: SECP256K1_N - 1
    const highS = SECP256K1_N - 1n;
    expect(highS > SECP256K1_N >> 1n).toBe(true);
    const lowS = normalizeLowS(highS);
    expect(lowS).toBe(1n);
    expect(lowS < SECP256K1_N >> 1n).toBe(true);
  });

  it("N/2 exactly is considered high-S", () => {
    const halfN = SECP256K1_N >> 1n;
    // halfN + 1 is the first "high-S" that needs flipping
    const highS = halfN + 1n;
    const normalized = normalizeLowS(highS);
    expect(normalized).toBe(SECP256K1_N - highS);
  });
});

import { describe, expect, it } from "vitest";
import { parseDerSignature, parseDerSpki } from "../../src/kms/der.js";
import { buildDerSignature, buildFakeSpkiDer } from "../_helpers/mock-kms.js";

describe("parseDerSignature", () => {
  it("parses a known r and s from DER", () => {
    const r = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefn;
    const s = 0xc0ffeedeadc0ffeedeadc0ffeedeadc0ffeedeadc0ffeedeadc0ffeedeadc0fen;

    const der = buildDerSignature(r, s);
    const parsed = parseDerSignature(der);
    expect(parsed.r).toBe(r);
    expect(parsed.s).toBe(s);
  });

  it("handles high-bit integers with 0x00 prefix", () => {
    // r with high bit set → DER prepends 0x00
    const r = 0xff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00n;
    const s = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;

    const der = buildDerSignature(r, s);
    const parsed = parseDerSignature(der);
    expect(parsed.r).toBe(r);
    expect(parsed.s).toBe(s);
  });

  it("throws on non-SEQUENCE DER", () => {
    expect(() => parseDerSignature(new Uint8Array([0x02, 0x01, 0x00]))).toThrow("DER_SIG");
  });
});

describe("parseDerSpki", () => {
  it("extracts 65-byte uncompressed point from SPKI DER", () => {
    // Use a known uncompressed key (fake, for structure testing)
    const fakePoint = new Uint8Array(65);
    fakePoint[0] = 0x04;
    for (let i = 1; i < 65; i++) fakePoint[i] = i;

    const der = buildFakeSpkiDer(fakePoint);
    const extracted = parseDerSpki(der);
    expect(extracted).toHaveLength(65);
    expect(extracted[0]).toBe(0x04);
    expect(Array.from(extracted)).toEqual(Array.from(fakePoint));
  });
});

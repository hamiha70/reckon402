import { describe, expect, it } from "vitest";
import { validateSignRequest } from "../../src/validation/schema.js";

const PINNED_EOA = "0x46bbb05aca9ea24118b8a57c8d3f317503384305";
const NOW_S = Math.floor(Date.now() / 1000);

const validBody = {
  typedData: {
    domain: {
      name:              "USD Coin",
      version:           "2",
      chainId:           84532,
      verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    types: {
      TransferWithAuthorization: [
        { name: "from",        type: "address" },
        { name: "to",          type: "address" },
        { name: "value",       type: "uint256" },
        { name: "validAfter",  type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce",       type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from:        PINNED_EOA,
      to:          "0x0ad507c6973eba86313794329ad9b12fbf24acd0",
      value:       "10000",
      validAfter:  "0",
      validBefore: String(NOW_S + 600),
      nonce:       "0x" + "ab".repeat(32),
    },
  },
};

describe("validateSignRequest — happy path", () => {
  it("accepts a valid Base Sepolia USDC request", () => {
    const result = validateSignRequest(validBody, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(true);
  });

  it("accepts Base mainnet chainId + USDC address", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        domain: {
          ...validBody.typedData.domain,
          chainId: 8453,
          verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(true);
  });
});

describe("validateSignRequest — validator rejects", () => {
  it("rejects wrong primaryType", () => {
    const body = {
      ...validBody,
      typedData: { ...validBody.typedData, primaryType: "Permit" },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TYPED_DATA");
  });

  it("rejects wrong domain.name", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        domain: { ...validBody.typedData.domain, name: "USDC" },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TYPED_DATA");
  });

  it("rejects unsupported chainId", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        domain: {
          ...validBody.typedData.domain,
          chainId: 1,
          verifyingContract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
  });

  it("rejects wrong verifyingContract for chainId", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        domain: {
          ...validBody.typedData.domain,
          chainId: 84532,
          verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // mainnet address on sepolia chainId
        },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DOMAIN_NOT_ALLOWLISTED");
  });

  it("rejects wrong from address", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        message: { ...validBody.typedData.message, from: "0x0000000000000000000000000000000000000001" },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FROM_MISMATCH");
  });

  it("rejects value above 10 USDC cap", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        message: { ...validBody.typedData.message, value: "10000001" },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALUE_TOO_LARGE");
  });

  it("rejects expired validBefore", () => {
    const body = {
      ...validBody,
      typedData: {
        ...validBody.typedData,
        message: { ...validBody.typedData.message, validBefore: String(NOW_S - 1) },
      },
    };
    const result = validateSignRequest(body, PINNED_EOA, NOW_S);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPIRED_VALID_BEFORE");
  });
});

export const ALLOWLISTED_USDC: Record<number, string> = {
  8453:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",   // Base mainnet
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",   // Base Sepolia
};

export const ALLOWED_CHAIN_IDS = [8453, 84532] as const;

// 10 USDC (6 decimals) — demo anti-abuse cap
export const MAX_VALUE = 10_000_000n;

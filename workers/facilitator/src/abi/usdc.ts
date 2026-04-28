/**
 * USDC EIP-3009 subset. Used by the facilitator worker for
 * transferWithAuthorization tx construction (settlement tx #1).
 */
export const USDC_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'v',           type: 'uint8'   },
      { name: 'r',           type: 'bytes32' },
      { name: 's',           type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'AuthorizationUsed',
    inputs: [
      { indexed: true,  name: 'authorizer', type: 'address' },
      { indexed: true,  name: 'nonce',      type: 'bytes32' },
    ],
    anonymous: false,
  },
] as const

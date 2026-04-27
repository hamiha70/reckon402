/**
 * Splitter ABI subset. Used by the facilitator worker for
 * distribute() tx construction (settlement tx #2) and by healthz
 * for the `token()` view probe.
 */
export const SPLITTER_ABI = [
  {
    type: 'function',
    name: 'distribute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentId', type: 'bytes32' },
      { name: 'amount',    type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'Distributed',
    inputs: [
      { indexed: true,  name: 'paymentId', type: 'bytes32' },
      { indexed: true,  name: 'slot',      type: 'uint8'   },
      { indexed: true,  name: 'recipient', type: 'address' },
      { indexed: false, name: 'bps',       type: 'uint16'  },
      { indexed: false, name: 'amount',    type: 'uint256' },
    ],
    anonymous: false,
  },
] as const

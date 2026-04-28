/**
 * Minimal ABI subset for ValidationRegistry.
 * Extracted from upstream commit UPSTREAM_ABI_COMMIT (see multichain.ts).
 *
 * Note: ValidationRegistry is NOT deployed on any chain at the pinned
 * commit; all read/write APIs throw VALIDATION_NOT_DEPLOYED in
 * multichain.ts. This ABI is carried for forward-compat so L4b can
 * wire writes the moment upstream deploys.
 *
 * Reads: getValidationStatus, getSummary, getAgentValidations, getValidatorRequests
 * Writes: validationRequest, validationResponse
 * Events: ValidationRequest, ValidationResponse
 */
export const VALIDATION_ABI = [
  // --- reads ---
  {
    type: 'function',
    name: 'getValidationStatus',
    stateMutability: 'view',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'response', type: 'uint8' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
      { name: 'lastUpdate', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'validatorAddresses', type: 'address[]' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'avgResponse', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'getAgentValidations',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    type: 'function',
    name: 'getValidatorRequests',
    stateMutability: 'view',
    inputs: [{ name: 'validatorAddress', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // --- writes ---
  {
    type: 'function',
    name: 'validationRequest',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'requestURI', type: 'string' },
      { name: 'requestHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'validationResponse',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestHash', type: 'bytes32' },
      { name: 'response', type: 'uint8' },
      { name: 'responseURI', type: 'string' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [],
  },
  // --- events ---
  {
    type: 'event',
    name: 'ValidationRequest',
    inputs: [
      { indexed: true, name: 'validatorAddress', type: 'address' },
      { indexed: true, name: 'agentId', type: 'uint256' },
      { indexed: false, name: 'requestURI', type: 'string' },
      { indexed: true, name: 'requestHash', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'ValidationResponse',
    inputs: [
      { indexed: true, name: 'validatorAddress', type: 'address' },
      { indexed: true, name: 'agentId', type: 'uint256' },
      { indexed: true, name: 'requestHash', type: 'bytes32' },
      { indexed: false, name: 'response', type: 'uint8' },
      { indexed: false, name: 'responseURI', type: 'string' },
      { indexed: false, name: 'responseHash', type: 'bytes32' },
      { indexed: false, name: 'tag', type: 'string' },
    ],
  },
] as const

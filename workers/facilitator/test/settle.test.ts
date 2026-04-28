import { describe, it, expect, vi, beforeEach } from 'vitest'
import { settleOnChain, type SettleEnv, type SettleInput } from '../src/settle.js'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SPLITTER = '0x1111111111111111111111111111111111111111'
const BUYER    = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

// viem is mocked at the module level: we replace createPublicClient + createWalletClient
// factories with stubs that return whatever the test sets on the spy objects. This
// lets us assert the EXACT args passed to writeContract (USDC function, Splitter
// function, and all numeric conversions), not just whether the settle call returned.

type WriteContractArgs = {
  address: `0x${string}`
  abi: unknown
  functionName: string
  args: unknown[]
}

const writeContractMock = vi.fn()
const waitForReceiptMock = vi.fn()
const getBlockMock = vi.fn()

vi.mock('viem', async (importActual) => {
  const actual = await importActual<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: () => ({
      waitForTransactionReceipt: waitForReceiptMock,
      getBlock: getBlockMock,
    }),
    createWalletClient: () => ({
      writeContract: writeContractMock,
    }),
  }
})

const ENV: SettleEnv = {
  FACILITATOR_PK: '0x' + '11'.repeat(32),
  USDC_ADDRESS: USDC,
  SPLITTER_ADDRESS: SPLITTER,
  BASE_SEPOLIA_RPC_PRIMARY: 'https://unused.local',
}

function makeInput(overrides: Partial<SettleInput['authorization']> = {}): SettleInput {
  const validBefore = String(Math.floor(Date.now() / 1000) + 600)
  const sig = ('0x'
    + 'aa'.repeat(32)     // r
    + 'bb'.repeat(32)     // s
    + '1c') as `0x${string}`   // v = 28
  return {
    authorization: {
      from: BUYER,
      to: SPLITTER,
      value: '10000',
      validAfter: '0',
      validBefore,
      nonce: '0x' + 'cc'.repeat(32),
      ...overrides,
    },
    signature: sig,
    paymentId: ('0x' + 'dd'.repeat(32)) as `0x${string}`,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────── happy path ──────────────────────

describe('settleOnChain — two-tx happy path', () => {
  it('submits USDC.transferWithAuthorization with CORRECT args, then Splitter.distribute', async () => {
    writeContractMock
      .mockResolvedValueOnce('0xtxAuth')
      .mockResolvedValueOnce('0xtxDist')
    waitForReceiptMock
      .mockResolvedValueOnce({ status: 'success', blockNumber: 42n, gasUsed: 50000n })
      .mockResolvedValueOnce({ status: 'success', blockNumber: 43n, gasUsed: 70000n })
    getBlockMock.mockResolvedValue({ timestamp: 1735000001n })

    const input = makeInput()
    const outcome = await settleOnChain(ENV, input)

    expect(outcome.success).toBe(true)
    if (outcome.success) {
      expect(outcome.transferTx).toBe('0xtxAuth')
      expect(outcome.distributeTx).toBe('0xtxDist')
      expect(outcome.blockNumber).toBe(42n)
      expect(outcome.gasUsed).toBe(120000n)
    }

    // Exactly two writeContract calls — tx1 USDC, tx2 Splitter.
    expect(writeContractMock).toHaveBeenCalledTimes(2)

    const tx1 = writeContractMock.mock.calls[0][0] as WriteContractArgs
    expect(tx1.address.toLowerCase()).toBe(USDC.toLowerCase())
    expect(tx1.functionName).toBe('transferWithAuthorization')
    // Canonical EIP-3009 arg order: from, to, value, validAfter, validBefore, nonce, v, r, s
    const a = input.authorization
    expect(tx1.args).toEqual([
      a.from,
      a.to,
      BigInt(a.value),
      BigInt(a.validAfter),
      BigInt(a.validBefore),
      a.nonce,
      28,                                                  // v
      '0x' + 'aa'.repeat(32),                              // r
      '0x' + 'bb'.repeat(32),                              // s
    ])

    const tx2 = writeContractMock.mock.calls[1][0] as WriteContractArgs
    expect(tx2.address.toLowerCase()).toBe(SPLITTER.toLowerCase())
    expect(tx2.functionName).toBe('distribute')
    expect(tx2.args).toEqual([
      input.paymentId,
      BigInt(a.value),
    ])
  })

  it('waits for BOTH receipts (transfer first, then distribute)', async () => {
    writeContractMock
      .mockResolvedValueOnce('0xt1')
      .mockResolvedValueOnce('0xt2')
    waitForReceiptMock
      .mockResolvedValueOnce({ status: 'success', blockNumber: 1n, gasUsed: 50000n })
      .mockResolvedValueOnce({ status: 'success', blockNumber: 2n, gasUsed: 70000n })
    getBlockMock.mockResolvedValue({ timestamp: 100n })

    await settleOnChain(ENV, makeInput())
    expect(waitForReceiptMock).toHaveBeenCalledTimes(2)
    const firstHash = (waitForReceiptMock.mock.calls[0][0] as { hash: string }).hash
    const secondHash = (waitForReceiptMock.mock.calls[1][0] as { hash: string }).hash
    expect(firstHash).toBe('0xt1')
    expect(secondHash).toBe('0xt2')
  })
})

// ────────────────────── failure paths ──────────────────────

describe('settleOnChain — failure paths', () => {
  it('returns DEADLINE_EXCEEDED when validBefore is already in the past', async () => {
    const outcome = await settleOnChain(ENV, makeInput({ validBefore: '1' }))
    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.failureReason).toBe('DEADLINE_EXCEEDED')
    }
    // No tx submitted when the deadline check short-circuits.
    expect(writeContractMock).not.toHaveBeenCalled()
  })

  it('returns OTHER when transferWithAuthorization submission throws', async () => {
    writeContractMock.mockRejectedValueOnce(new Error('insufficient funds'))

    const outcome = await settleOnChain(ENV, makeInput())
    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.failureReason).toBe('OTHER')
      expect(outcome.failureDetail).toMatch(/transferWithAuthorization_submit_failed/)
      expect(outcome.failureDetail).toMatch(/insufficient funds/)
    }
    // Only one call attempted (transfer); distribute never ran.
    expect(writeContractMock).toHaveBeenCalledTimes(1)
  })

  it('returns TX_REVERTED when the transfer receipt reports reverted', async () => {
    writeContractMock.mockResolvedValueOnce('0xtransfer')
    waitForReceiptMock.mockResolvedValueOnce({ status: 'reverted', blockNumber: 10n, gasUsed: 50000n })

    const outcome = await settleOnChain(ENV, makeInput())
    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.failureReason).toBe('TX_REVERTED')
      expect(outcome.transferTx).toBe('0xtransfer')
      expect(outcome.distributeTx).toBeUndefined()
    }
    // distribute() never submitted when the transfer fails.
    expect(writeContractMock).toHaveBeenCalledTimes(1)
  })

  it('returns TX_REVERTED when the Splitter.distribute receipt reports reverted', async () => {
    writeContractMock
      .mockResolvedValueOnce('0xtransferOk')
      .mockResolvedValueOnce('0xdistributeFail')
    waitForReceiptMock
      .mockResolvedValueOnce({ status: 'success', blockNumber: 42n, gasUsed: 50000n })
      .mockResolvedValueOnce({ status: 'reverted', blockNumber: 43n, gasUsed: 30000n })

    const outcome = await settleOnChain(ENV, makeInput())
    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.failureReason).toBe('TX_REVERTED')
      expect(outcome.transferTx).toBe('0xtransferOk')
      expect(outcome.distributeTx).toBe('0xdistributeFail')
      expect(outcome.failureDetail).toMatch(/distribute reverted/)
    }
  })

  it('returns OTHER when waitForTransactionReceipt throws (timeout path)', async () => {
    writeContractMock.mockResolvedValueOnce('0xpending')
    waitForReceiptMock.mockRejectedValueOnce(new Error('Timed out while waiting'))

    const outcome = await settleOnChain(ENV, makeInput())
    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.failureReason).toBe('OTHER')
      expect(outcome.failureDetail).toMatch(/transfer_receipt_timeout/)
    }
  })

  it('returns OTHER when Splitter.distribute submission throws', async () => {
    writeContractMock
      .mockResolvedValueOnce('0xtransferOk')
      .mockRejectedValueOnce(new Error('nonce too low'))
    waitForReceiptMock.mockResolvedValueOnce({ status: 'success', blockNumber: 42n, gasUsed: 50000n })

    const outcome = await settleOnChain(ENV, makeInput())
    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.failureReason).toBe('OTHER')
      expect(outcome.failureDetail).toMatch(/distribute_submit_failed/)
      expect(outcome.transferTx).toBe('0xtransferOk')
    }
  })
})

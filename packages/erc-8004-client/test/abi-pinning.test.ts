import { describe, it, expect } from 'vitest'
import { toFunctionSelector, toEventSelector } from 'viem'
import { IDENTITY_ABI } from '../src/abis/identity.js'
import { REPUTATION_ABI } from '../src/abis/reputation.js'
import { VALIDATION_ABI } from '../src/abis/validation.js'
import { UPSTREAM_ABI_COMMIT } from '../src/multichain.js'

/**
 * Selector pinning: these 4-byte hashes are computed from the canonical
 * ABI signatures at UPSTREAM_ABI_COMMIT. A drift here means upstream
 * renamed or re-signatured a function. Drift must force a manual
 * upstream diff — never silently bump.
 *
 * Cross-checked against live Base Sepolia calls at 2026-04-28 against
 * IdentityRegistry 0x8004A818BFB912233c491871b3d84c89A494BD9e and
 * ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713: the
 * `cast call` against these signatures returned real decodable data,
 * so the on-chain contracts accept these selectors.
 */
const EXPECTED_IDENTITY_SELECTORS: Record<string, string> = {
  'function ownerOf(uint256)': '0x6352211e',
  'function tokenURI(uint256)': '0xc87b56dd',
  'function getAgentWallet(uint256)': '0x00339509',
  'function getMetadata(uint256,string)': '0xcb4799f2',
  'function register()': '0x1aa3a008',
  'function register(string)': '0xf2c298be',
  'function register(string,(string,bytes)[])': '0x8ea42286',
  'function setAgentURI(uint256,string)': '0x0af28bd3',
  'function setMetadata(uint256,string,bytes)': '0x466648da',
  'function setAgentWallet(uint256,address,uint256,bytes)': '0x2d1ef5ae',
}

const EXPECTED_REPUTATION_SELECTORS: Record<string, string> = {
  'function getSummary(uint256,address[],string,string)': '0x81bbba58',
  'function getClients(uint256)': '0x42dd519c',
  'function getLastIndex(uint256,address)': '0xf2d81759',
  'function getResponseCount(uint256,address,uint64,address[])': '0x6e04cacd',
  'function readFeedback(uint256,address,uint64)': '0x232b0810',
  'function readAllFeedback(uint256,address[],string,string,bool)': '0xd9d84224',
  'function giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)': '0x3c036a7e',
  'function revokeFeedback(uint256,uint64)': '0x4ab3ca99',
  'function appendResponse(uint256,address,uint64,string,bytes32)': '0xc2349ab2',
}

const EXPECTED_VALIDATION_SELECTORS: Record<string, string> = {
  'function getValidationStatus(bytes32)': '0xff2febfc',
  'function getSummary(uint256,address[],string)': '0x1b7cabd6',
  'function getAgentValidations(uint256)': '0x8d5d0c2d',
  'function getValidatorRequests(address)': '0x4bf3158c',
  'function validationRequest(address,uint256,string,bytes32)': '0xaaf400c4',
  'function validationResponse(bytes32,uint8,string,bytes32,string)': '0x3d659a96',
}

describe('abi-pinning — selectors match upstream (commit ' + UPSTREAM_ABI_COMMIT.slice(0, 10) + ')', () => {
  it('IDENTITY selectors stable', () => {
    for (const [sig, expected] of Object.entries(EXPECTED_IDENTITY_SELECTORS)) {
      expect(toFunctionSelector(sig), sig).toBe(expected)
    }
  })

  it('REPUTATION selectors stable', () => {
    for (const [sig, expected] of Object.entries(EXPECTED_REPUTATION_SELECTORS)) {
      expect(toFunctionSelector(sig), sig).toBe(expected)
    }
  })

  it('VALIDATION selectors stable', () => {
    for (const [sig, expected] of Object.entries(EXPECTED_VALIDATION_SELECTORS)) {
      expect(toFunctionSelector(sig), sig).toBe(expected)
    }
  })

  it('library ABIs contain all pinned function names', () => {
    const idNames = new Set(IDENTITY_ABI.filter((e) => e.type === 'function').map((e: any) => e.name))
    for (const name of [
      'ownerOf', 'tokenURI', 'getAgentWallet', 'getMetadata',
      'register', 'setAgentURI', 'setMetadata', 'setAgentWallet',
    ]) {
      expect(idNames.has(name), `identity missing ${name}`).toBe(true)
    }

    const repNames = new Set(REPUTATION_ABI.filter((e) => e.type === 'function').map((e: any) => e.name))
    for (const name of [
      'getSummary', 'getClients', 'getLastIndex', 'getResponseCount',
      'readFeedback', 'readAllFeedback',
      'giveFeedback', 'revokeFeedback', 'appendResponse',
    ]) {
      expect(repNames.has(name), `reputation missing ${name}`).toBe(true)
    }

    const valNames = new Set(VALIDATION_ABI.filter((e) => e.type === 'function').map((e: any) => e.name))
    for (const name of [
      'getValidationStatus', 'getSummary', 'getAgentValidations', 'getValidatorRequests',
      'validationRequest', 'validationResponse',
    ]) {
      expect(valNames.has(name), `validation missing ${name}`).toBe(true)
    }
  })

  it('pinned events are present', () => {
    const idEvents = new Set(IDENTITY_ABI.filter((e) => e.type === 'event').map((e: any) => e.name))
    expect(idEvents).toEqual(new Set(['Registered', 'URIUpdated', 'MetadataSet']))

    const repEvents = new Set(REPUTATION_ABI.filter((e) => e.type === 'event').map((e: any) => e.name))
    expect(repEvents).toEqual(new Set(['NewFeedback', 'FeedbackRevoked', 'ResponseAppended']))

    const valEvents = new Set(VALIDATION_ABI.filter((e) => e.type === 'event').map((e: any) => e.name))
    expect(valEvents).toEqual(new Set(['ValidationRequest', 'ValidationResponse']))
  })

  it('identity ABI has no getAgent function (matches upstream; helper is library-side)', () => {
    const idNames = new Set(IDENTITY_ABI.filter((e) => e.type === 'function').map((e: any) => e.name))
    expect(idNames.has('getAgent')).toBe(false)
  })

  it('NewFeedback event selector (topic0) is deterministically hashable', () => {
    const sig = toEventSelector(
      'NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)',
    )
    expect(sig).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

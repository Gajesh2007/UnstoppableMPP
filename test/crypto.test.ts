import { describe, test, expect, beforeAll } from 'bun:test'
import { encrypt } from 'eciesjs'
import { initPlatform, getPlatformAddress, getPlatformPublicKey, decryptApiKey } from '../src/crypto/platform'

beforeAll(() => {
  initPlatform()
})

describe('Platform Key Derivation', () => {
  test('derives a valid EVM address from mnemonic', () => {
    const addr = getPlatformAddress()
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('derives deterministic address from same mnemonic', () => {
    const addr1 = getPlatformAddress()
    const addr2 = getPlatformAddress()
    expect(addr1).toBe(addr2)
  })

  test('derives a valid secp256k1 public key', () => {
    const pk = getPlatformPublicKey()
    expect(pk).toMatch(/^[0-9a-f]{66}$/) // compressed pubkey = 33 bytes = 66 hex chars
  })

  test('known mnemonic produces known address', () => {
    // "test test ... junk" is the Hardhat/Foundry default mnemonic
    expect(getPlatformAddress()).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })
})

describe('ECIES Encrypt/Decrypt', () => {
  test('decrypts an API key encrypted to the platform public key', () => {
    const originalKey = 'sk-proj-this-is-a-test-key-1234567890'
    const pk = getPlatformPublicKey()
    const encrypted = Buffer.from(encrypt(pk, Buffer.from(originalKey))).toString('hex')
    const decrypted = decryptApiKey(encrypted)
    expect(decrypted).toBe(originalKey)
  })

  test('decrypts keys with special characters', () => {
    const key = 'sk-proj-aB3$_special!@#chars'
    const pk = getPlatformPublicKey()
    const encrypted = Buffer.from(encrypt(pk, Buffer.from(key))).toString('hex')
    expect(decryptApiKey(encrypted)).toBe(key)
  })

  test('different encryptions of same key produce different ciphertexts', () => {
    const key = 'sk-proj-test'
    const pk = getPlatformPublicKey()
    const enc1 = Buffer.from(encrypt(pk, Buffer.from(key))).toString('hex')
    const enc2 = Buffer.from(encrypt(pk, Buffer.from(key))).toString('hex')
    expect(enc1).not.toBe(enc2) // ECIES uses random ephemeral key each time
    expect(decryptApiKey(enc1)).toBe(key)
    expect(decryptApiKey(enc2)).toBe(key)
  })

  test('throws on invalid ciphertext', () => {
    expect(() => decryptApiKey('deadbeef')).toThrow()
  })
})

import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { encrypt } from 'eciesjs'
import { eq } from 'drizzle-orm'
process.env.DATABASE_PATH = './data/test-health.db'
import { initPlatform, getPlatformPublicKey } from '../src/crypto/platform'
import { getDb } from '../src/db/client'
import { apiKeys, sellers } from '../src/db/schema'
import { markKeyFailure, markKeySuccess } from '../src/health/tracker'

function encryptKey(key: string): string {
  return Buffer.from(encrypt(getPlatformPublicKey(), Buffer.from(key))).toString('hex')
}

beforeAll(() => {
  initPlatform()
  getDb()
})

beforeEach(async () => {
  const db = getDb()
  await db.delete(apiKeys)
  await db.delete(sellers)

  await db.insert(sellers).values({
    id: 'seller-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    authTokenHash: 'test-hash',
    balance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await db.insert(apiKeys).values({
    id: 'key-1',
    sellerId: 'seller-1',
    encryptedKey: encryptKey('sk-test'),
    markupPct: 0,
    spentUsd: 0,
    isActive: true,
    isHealthy: true,
    failureCount: 0,
    createdAt: new Date(),
  })
})

describe('Health Tracker', () => {
  test('markKeyFailure increments failure count', async () => {
    await markKeyFailure('key-1')
    const db = getDb()
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'key-1') })
    expect(key!.failureCount).toBe(1)
    expect(key!.isActive).toBe(true) // Still active after 1 failure
  })

  test('key evicted after 3 consecutive failures', async () => {
    await markKeyFailure('key-1')
    await markKeyFailure('key-1')
    await markKeyFailure('key-1')

    const db = getDb()
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'key-1') })
    expect(key!.failureCount).toBe(3)
    expect(key!.isHealthy).toBe(false)
    expect(key!.isActive).toBe(false) // Evicted — permanently deactivated
  })

  test('markKeySuccess resets failure count', async () => {
    await markKeyFailure('key-1')
    await markKeyFailure('key-1')

    await markKeySuccess('key-1')

    const db = getDb()
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'key-1') })
    expect(key!.failureCount).toBe(0)
    expect(key!.isHealthy).toBe(true)
  })

  test('evicted key stays evicted even after markKeySuccess', async () => {
    // Evict the key
    await markKeyFailure('key-1')
    await markKeyFailure('key-1')
    await markKeyFailure('key-1')

    const db = getDb()
    let key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'key-1') })
    expect(key!.isActive).toBe(false)

    // markKeySuccess updates health/failure but isActive stays false
    // (seller must re-register a new key)
    await markKeySuccess('key-1')
    key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'key-1') })
    expect(key!.isHealthy).toBe(true)
    expect(key!.failureCount).toBe(0)
    expect(key!.isActive).toBe(false) // Still evicted
  })

  test('markKeyFailure on nonexistent key does not throw', async () => {
    await markKeyFailure('nonexistent-key')
  })
})

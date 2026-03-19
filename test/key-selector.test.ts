import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { encrypt } from 'eciesjs'
import { eq } from 'drizzle-orm'
process.env.DATABASE_PATH = './data/test-keys.db'
import { initPlatform, getPlatformPublicKey } from '../src/crypto/platform'
import { getDb } from '../src/db/client'
import { apiKeys, sellers } from '../src/db/schema'
import { selectCheapestKey, selectNextKey, recordSpend } from '../src/proxy/key-selector'

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

  // Insert test seller
  await db.insert(sellers).values({
    id: 'seller-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    authTokenHash: 'test-hash',
    balance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

describe('selectCheapestKey', () => {
  test('selects the key with lowest markup', async () => {
    const db = getDb()
    await db.insert(apiKeys).values([
      {
        id: 'key-expensive',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-expensive'),
        markupPct: 20,
        spentUsd: 0,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
      {
        id: 'key-cheap',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-cheap'),
        markupPct: -10,
        spentUsd: 0,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
    ])

    const selected = await selectCheapestKey()
    expect(selected.id).toBe('key-cheap')
    expect(selected.markupPct).toBe(-10)
    expect(selected.decryptedKey).toBe('sk-cheap')
  })

  test('skips inactive keys', async () => {
    const db = getDb()
    await db.insert(apiKeys).values([
      {
        id: 'key-inactive',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-inactive'),
        markupPct: -50,
        spentUsd: 0,
        isActive: false,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
      {
        id: 'key-active',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-active'),
        markupPct: 10,
        spentUsd: 0,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
    ])

    const selected = await selectCheapestKey()
    expect(selected.id).toBe('key-active')
  })

  test('skips unhealthy keys', async () => {
    const db = getDb()
    await db.insert(apiKeys).values([
      {
        id: 'key-unhealthy',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-unhealthy'),
        markupPct: -50,
        spentUsd: 0,
        isActive: true,
        isHealthy: false,
        failureCount: 5,
        createdAt: new Date(),
      },
      {
        id: 'key-healthy',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-healthy'),
        markupPct: 10,
        spentUsd: 0,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
    ])

    const selected = await selectCheapestKey()
    expect(selected.id).toBe('key-healthy')
  })

  test('skips keys that exceeded spending limit', async () => {
    const db = getDb()
    await db.insert(apiKeys).values([
      {
        id: 'key-maxed',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-maxed'),
        markupPct: -50,
        spendingLimitUsd: 10,
        spentUsd: 10,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
      {
        id: 'key-budget',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-budget'),
        markupPct: 5,
        spendingLimitUsd: 100,
        spentUsd: 1,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
    ])

    const selected = await selectCheapestKey()
    expect(selected.id).toBe('key-budget')
  })

  test('keys with no spending limit are always eligible', async () => {
    const db = getDb()
    await db.insert(apiKeys).values({
      id: 'key-unlimited',
      sellerId: 'seller-1',
      encryptedKey: encryptKey('sk-unlimited'),
      markupPct: 0,
      spentUsd: 99999,
      isActive: true,
      isHealthy: true,
      failureCount: 0,
      createdAt: new Date(),
    })

    const selected = await selectCheapestKey()
    expect(selected.id).toBe('key-unlimited')
  })

  test('throws when no keys available', async () => {
    expect(selectCheapestKey()).rejects.toThrow('No healthy API keys')
  })
})

describe('selectNextKey', () => {
  test('excludes specified key IDs', async () => {
    const db = getDb()
    await db.insert(apiKeys).values([
      {
        id: 'key-a',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-a'),
        markupPct: -10,
        spentUsd: 0,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
      {
        id: 'key-b',
        sellerId: 'seller-1',
        encryptedKey: encryptKey('sk-b'),
        markupPct: 0,
        spentUsd: 0,
        isActive: true,
        isHealthy: true,
        failureCount: 0,
        createdAt: new Date(),
      },
    ])

    const next = await selectNextKey(['key-a'])
    expect(next.id).toBe('key-b')
  })

  test('throws when all keys excluded', async () => {
    const db = getDb()
    await db.insert(apiKeys).values({
      id: 'key-only',
      sellerId: 'seller-1',
      encryptedKey: encryptKey('sk-only'),
      markupPct: 0,
      spentUsd: 0,
      isActive: true,
      isHealthy: true,
      failureCount: 0,
      createdAt: new Date(),
    })

    expect(selectNextKey(['key-only'])).rejects.toThrow('No healthy API keys')
  })
})

describe('recordSpend', () => {
  test('increments spent amount', async () => {
    const db = getDb()
    await db.insert(apiKeys).values({
      id: 'key-spend',
      sellerId: 'seller-1',
      encryptedKey: encryptKey('sk-spend'),
      markupPct: 0,
      spendingLimitUsd: 100,
      spentUsd: 0,
      isActive: true,
      isHealthy: true,
      failureCount: 0,
      createdAt: new Date(),
    })

    await recordSpend('key-spend', 5.50)
    const key = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, 'key-spend'),
    })
    expect(key!.spentUsd).toBeCloseTo(5.50)

    await recordSpend('key-spend', 2.25)
    const key2 = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, 'key-spend'),
    })
    expect(key2!.spentUsd).toBeCloseTo(7.75)
  })
})

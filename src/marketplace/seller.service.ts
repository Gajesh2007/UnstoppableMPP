import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { randomBytes } from 'node:crypto'
import { getDb } from '../db/client'
import { sellers, apiKeys } from '../db/schema'
import { hashToken } from './auth'
import { decryptApiKey } from '../crypto/platform'
import { SellerNotFoundError } from '../utils/errors'

export async function registerSeller(walletAddress: string) {
  const db = getDb()
  const id = nanoid()
  const authToken = randomBytes(32).toString('hex')
  const authTokenHash = hashToken(authToken)
  const now = new Date()

  await db.insert(sellers).values({
    id,
    walletAddress,
    authTokenHash,
    balance: 0,
    createdAt: now,
    updatedAt: now,
  })

  return { id, authToken }
}

/**
 * Add an API key. The key must already be ECIES-encrypted (hex) to the platform's public key.
 * We verify it can be decrypted and looks like an OpenAI key before storing.
 */
export async function addApiKey(
  sellerId: string,
  encryptedKeyHex: string,
  spendingLimitUsd: number | null,
  markupPct: number
) {
  // Verify we can decrypt it and it looks like an OpenAI key
  const plainKey = decryptApiKey(encryptedKeyHex)
  if (!plainKey.startsWith('sk-')) {
    throw new Error('Decrypted key does not look like a valid OpenAI API key')
  }

  const db = getDb()
  const id = nanoid()

  await db.insert(apiKeys).values({
    id,
    sellerId,
    encryptedKey: encryptedKeyHex,
    spendingLimitUsd,
    markupPct,
    isActive: true,
    isHealthy: true,
    failureCount: 0,
    spentUsd: 0,
    createdAt: new Date(),
  })

  return { id }
}

export async function listKeys(sellerId: string) {
  const db = getDb()
  return db.query.apiKeys.findMany({
    where: eq(apiKeys.sellerId, sellerId),
    columns: {
      id: true,
      spendingLimitUsd: true,
      spentUsd: true,
      markupPct: true,
      isActive: true,
      isHealthy: true,
      failureCount: true,
      lastHealthCheck: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })
}

export async function updateKey(
  sellerId: string,
  keyId: string,
  updates: { spendingLimitUsd?: number | null; markupPct?: number }
) {
  const db = getDb()
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, sellerId)),
  })

  if (!key) throw new SellerNotFoundError()

  await db
    .update(apiKeys)
    .set(updates)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, sellerId)))

  return { id: keyId, ...updates }
}

export async function deactivateKey(sellerId: string, keyId: string) {
  const db = getDb()
  return db
    .update(apiKeys)
    .set({ isActive: false })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, sellerId)))
}

export async function getSellerBalance(sellerId: string) {
  const db = getDb()
  const seller = await db.query.sellers.findFirst({
    where: eq(sellers.id, sellerId),
    columns: { balance: true, walletAddress: true },
  })

  if (!seller) throw new SellerNotFoundError()
  return seller
}

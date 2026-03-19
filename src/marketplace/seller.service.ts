import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb } from '../db/client'
import { sellers, apiKeys } from '../db/schema'
import { decryptApiKey } from '../crypto/platform'

/**
 * Get or create a seller by wallet address.
 * Called on first sign-in — if the seller doesn't exist, we create them.
 */
export async function getOrCreateSeller(walletAddress: string) {
  const db = getDb()
  const addr = walletAddress.toLowerCase()

  let seller = await db.query.sellers.findFirst({
    where: eq(sellers.walletAddress, addr),
  })

  if (!seller) {
    const id = nanoid()
    const now = new Date()
    await db.insert(sellers).values({
      id,
      walletAddress: addr,
      authTokenHash: '', // No longer used — auth via wallet signature
      balance: 0,
      createdAt: now,
      updatedAt: now,
    })
    seller = await db.query.sellers.findFirst({
      where: eq(sellers.id, id),
    })
  }

  return seller!
}

/**
 * Add an API key. The key must already be ECIES-encrypted (hex) to the platform's public key.
 */
export async function addApiKey(
  walletAddress: string,
  encryptedKeyHex: string,
  spendingLimitUsd: number | null,
  markupPct: number
) {
  const seller = await getOrCreateSeller(walletAddress)

  // Verify we can decrypt it and it looks like an OpenAI key
  const plainKey = decryptApiKey(encryptedKeyHex)
  if (!plainKey.startsWith('sk-')) {
    throw new Error('Decrypted key does not look like a valid OpenAI API key')
  }

  const db = getDb()
  const id = nanoid()

  await db.insert(apiKeys).values({
    id,
    sellerId: seller.id,
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

export async function listKeys(walletAddress: string) {
  const seller = await getOrCreateSeller(walletAddress)
  const db = getDb()
  return db.query.apiKeys.findMany({
    where: eq(apiKeys.sellerId, seller.id),
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
  walletAddress: string,
  keyId: string,
  updates: { spendingLimitUsd?: number | null; markupPct?: number }
) {
  const seller = await getOrCreateSeller(walletAddress)
  const db = getDb()
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, seller.id)),
  })

  if (!key) throw new Error('Key not found')

  await db
    .update(apiKeys)
    .set(updates)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, seller.id)))

  return { id: keyId, ...updates }
}

/**
 * Delist a key — deactivate it permanently.
 */
export async function delistKey(walletAddress: string, keyId: string) {
  const seller = await getOrCreateSeller(walletAddress)
  const db = getDb()
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, seller.id)),
  })

  if (!key) throw new Error('Key not found')

  await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.sellerId, seller.id)))
}

export async function getSellerBalance(walletAddress: string) {
  const seller = await getOrCreateSeller(walletAddress)
  return { balance: seller.balance, walletAddress: seller.walletAddress }
}

export async function getSellerId(walletAddress: string): Promise<string> {
  const seller = await getOrCreateSeller(walletAddress)
  return seller.id
}

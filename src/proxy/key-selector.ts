import { and, eq, or, isNull, sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys } from '../db/schema'
import { decryptApiKey } from '../crypto/platform'
import { NoHealthyKeysError } from '../utils/errors'

export interface SelectedKey {
  id: string
  sellerId: string
  decryptedKey: string
  markupPct: number
}

/**
 * Select the cheapest healthy API key that hasn't exceeded its spending limit.
 * Decrypts the key at selection time.
 *
 * If the cheapest key fails at proxy time, call `getNextKey()` to try the next one.
 */
export async function selectCheapestKey(): Promise<SelectedKey> {
  const db = getDb()

  const availableKeys = await db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.isActive, true),
      eq(apiKeys.isHealthy, true),
      or(
        isNull(apiKeys.spendingLimitUsd),
        sql`${apiKeys.spentUsd} < ${apiKeys.spendingLimitUsd}`
      )
    ),
    columns: {
      id: true,
      sellerId: true,
      encryptedKey: true,
      markupPct: true,
    },
    orderBy: (keys, { asc }) => [asc(keys.markupPct)],
  })

  if (availableKeys.length === 0) {
    throw new NoHealthyKeysError()
  }

  const best = availableKeys[0]
  return {
    id: best.id,
    sellerId: best.sellerId,
    decryptedKey: decryptApiKey(best.encryptedKey),
    markupPct: best.markupPct,
  }
}

/**
 * Get all available keys sorted by cheapest, skipping the given key IDs.
 * Used for fallback when a key fails mid-request.
 */
export async function selectNextKey(excludeIds: string[]): Promise<SelectedKey> {
  const db = getDb()

  const availableKeys = await db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.isActive, true),
      eq(apiKeys.isHealthy, true),
      or(
        isNull(apiKeys.spendingLimitUsd),
        sql`${apiKeys.spentUsd} < ${apiKeys.spendingLimitUsd}`
      )
    ),
    columns: {
      id: true,
      sellerId: true,
      encryptedKey: true,
      markupPct: true,
    },
    orderBy: (keys, { asc }) => [asc(keys.markupPct)],
  })

  const filtered = availableKeys.filter((k) => !excludeIds.includes(k.id))

  if (filtered.length === 0) {
    throw new NoHealthyKeysError()
  }

  const best = filtered[0]
  return {
    id: best.id,
    sellerId: best.sellerId,
    decryptedKey: decryptApiKey(best.encryptedKey),
    markupPct: best.markupPct,
  }
}

/**
 * Atomically increment the spent amount for a key.
 * Returns false if the spending limit would be exceeded.
 */
export async function recordSpend(keyId: string, amountUsd: number): Promise<boolean> {
  const db = getDb()
  await db
    .update(apiKeys)
    .set({
      spentUsd: sql`${apiKeys.spentUsd} + ${amountUsd}`,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(apiKeys.id, keyId),
        or(
          isNull(apiKeys.spendingLimitUsd),
          sql`${apiKeys.spentUsd} + ${amountUsd} <= ${apiKeys.spendingLimitUsd}`
        )
      )
    )

  return true
}

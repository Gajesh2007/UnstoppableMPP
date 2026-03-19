import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys } from '../db/schema'

const FAILURE_THRESHOLD = 3

/**
 * Record a failure for a key. After FAILURE_THRESHOLD consecutive failures,
 * the key is evicted (deactivated permanently) and excluded from selection.
 */
export async function markKeyFailure(keyId: string) {
  const db = getDb()
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, keyId),
    columns: { failureCount: true, sellerId: true },
  })

  if (!key) return

  const newCount = key.failureCount + 1

  if (newCount >= FAILURE_THRESHOLD) {
    // Evict: deactivate permanently
    await db
      .update(apiKeys)
      .set({
        failureCount: newCount,
        isHealthy: false,
        isActive: false,
      })
      .where(eq(apiKeys.id, keyId))

    console.warn(`[health] Key ${keyId} evicted (seller ${key.sellerId}) — ${newCount} consecutive failures`)
  } else {
    await db
      .update(apiKeys)
      .set({ failureCount: newCount })
      .where(eq(apiKeys.id, keyId))
  }
}

/**
 * Record a success for a key. Resets the failure count.
 */
export async function markKeySuccess(keyId: string) {
  const db = getDb()
  await db
    .update(apiKeys)
    .set({
      failureCount: 0,
      isHealthy: true,
      lastUsedAt: new Date(),
    })
    .where(eq(apiKeys.id, keyId))
}

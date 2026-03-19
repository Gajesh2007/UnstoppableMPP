import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys } from '../db/schema'

const FAILURE_THRESHOLD = 3

/**
 * Record a failure for a key. After FAILURE_THRESHOLD consecutive failures,
 * the key is marked unhealthy and excluded from selection.
 */
export async function markKeyFailure(keyId: string) {
  const db = getDb()
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, keyId),
    columns: { failureCount: true },
  })

  if (!key) return

  const newCount = key.failureCount + 1
  const isHealthy = newCount < FAILURE_THRESHOLD

  await db
    .update(apiKeys)
    .set({
      failureCount: newCount,
      isHealthy,
    })
    .where(eq(apiKeys.id, keyId))

  if (!isHealthy) {
    console.warn(`[health] Key ${keyId} marked unhealthy after ${newCount} consecutive failures`)
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

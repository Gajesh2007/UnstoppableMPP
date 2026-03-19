import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys } from '../db/schema'
import { decryptApiKey } from '../crypto/platform'

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let interval: ReturnType<typeof setInterval> | null = null

/**
 * Check a single API key by making a lightweight GET /v1/models call to OpenAI.
 * Returns the HTTP status for eviction decisions.
 */
async function checkKeyHealth(encryptedKey: string): Promise<{ ok: boolean; status: number }> {
  try {
    const plainKey = decryptApiKey(encryptedKey)
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    return { ok: response.status === 200, status: response.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

/**
 * Run a health check on all active keys.
 * Keys that fail with 401/403 (revoked/invalid) are evicted immediately.
 * Keys that fail for transient reasons (429, network) get failure count incremented.
 */
async function runHealthChecks() {
  const db = getDb()
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.isActive, true),
    columns: {
      id: true,
      sellerId: true,
      encryptedKey: true,
      failureCount: true,
    },
  })

  const now = new Date()
  let healthy = 0
  let evicted = 0

  for (const key of keys) {
    const { ok, status } = await checkKeyHealth(key.encryptedKey)

    if (ok) {
      await db
        .update(apiKeys)
        .set({ isHealthy: true, failureCount: 0, lastHealthCheck: now })
        .where(eq(apiKeys.id, key.id))
      healthy++
      continue
    }

    // 401/403 = key is revoked or invalid — evict immediately
    if (status === 401 || status === 403) {
      await db
        .update(apiKeys)
        .set({ isHealthy: false, isActive: false, lastHealthCheck: now })
        .where(eq(apiKeys.id, key.id))
      evicted++
      console.warn(`[health] Key ${key.id} evicted (seller ${key.sellerId}) — OpenAI returned ${status}`)
      continue
    }

    // Transient failure (429, network error) — increment failure count
    const newCount = key.failureCount + 1
    if (newCount >= 3) {
      await db
        .update(apiKeys)
        .set({ isHealthy: false, isActive: false, failureCount: newCount, lastHealthCheck: now })
        .where(eq(apiKeys.id, key.id))
      evicted++
      console.warn(`[health] Key ${key.id} evicted (seller ${key.sellerId}) — ${newCount} consecutive health check failures`)
    } else {
      await db
        .update(apiKeys)
        .set({ isHealthy: false, failureCount: newCount, lastHealthCheck: now })
        .where(eq(apiKeys.id, key.id))
    }
  }

  const active = keys.length - evicted
  console.log(`[health] Check complete: ${healthy} healthy, ${active - healthy} unhealthy, ${evicted} evicted out of ${keys.length} keys`)
}

export function startHealthMonitor() {
  runHealthChecks().catch((err) =>
    console.error('[health] Initial check failed:', err)
  )

  interval = setInterval(() => {
    runHealthChecks().catch((err) =>
      console.error('[health] Check failed:', err)
    )
  }, HEALTH_CHECK_INTERVAL_MS)
}

export function stopHealthMonitor() {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
}

import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys } from '../db/schema'
import { decryptApiKey } from '../crypto/platform'

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let interval: ReturnType<typeof setInterval> | null = null

/**
 * Check a single API key by making a lightweight GET /v1/models call to OpenAI.
 */
async function checkKeyHealth(keyId: string, encryptedKey: string): Promise<boolean> {
  try {
    const plainKey = decryptApiKey(encryptedKey)
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    return response.status === 200
  } catch {
    return false
  }
}

/**
 * Run a health check on all active keys.
 */
async function runHealthChecks() {
  const db = getDb()
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.isActive, true),
    columns: {
      id: true,
      encryptedKey: true,
      isHealthy: true,
    },
  })

  const now = new Date()
  let healthy = 0
  let unhealthy = 0

  for (const key of keys) {
    const isHealthy = await checkKeyHealth(key.id, key.encryptedKey)

    await db
      .update(apiKeys)
      .set({
        isHealthy,
        failureCount: isHealthy ? 0 : (key.isHealthy ? 1 : undefined),
        lastHealthCheck: now,
      })
      .where(eq(apiKeys.id, key.id))

    if (isHealthy) healthy++
    else unhealthy++
  }

  console.log(`[health] Check complete: ${healthy} healthy, ${unhealthy} unhealthy out of ${keys.length} keys`)
}

export function startHealthMonitor() {
  // Run immediately on startup
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

import { createMiddleware } from 'hono/factory'

interface CachedResponse {
  status: number
  body: string
  headers: Record<string, string>
  createdAt: number
}

// In-memory idempotency store with 15-minute TTL
const store = new Map<string, CachedResponse>()
const TTL_MS = 15 * 60 * 1000

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(key)
  }
}, 5 * 60_000)

/**
 * Idempotency middleware per MPP spec.
 * Accepts `Idempotency-Key` header for safe retries on non-idempotent methods.
 * Returns cached response if the same key is seen again within TTL.
 */
export const idempotency = createMiddleware(async (c, next) => {
  const idempotencyKey = c.req.header('idempotency-key')

  // Only apply to non-idempotent methods
  if (!idempotencyKey || ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    await next()
    return
  }

  // Check cache
  const cached = store.get(idempotencyKey)
  if (cached) {
    c.header('X-Idempotency-Replayed', 'true')
    for (const [k, v] of Object.entries(cached.headers)) {
      c.header(k, v)
    }
    return c.body(cached.body, cached.status as 200)
  }

  await next()

  // Cache the response — but NEVER cache 402 (MPP challenges are single-use per spec)
  if (c.res.status >= 200 && c.res.status < 500 && c.res.status !== 402) {
    const cloned = c.res.clone()
    const body = await cloned.text()
    const headers: Record<string, string> = {}
    cloned.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'content-length'].includes(k.toLowerCase())) {
        headers[k] = v
      }
    })

    store.set(idempotencyKey, {
      status: cloned.status,
      body,
      headers,
      createdAt: Date.now(),
    })
  }
})

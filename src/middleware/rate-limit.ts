import { createMiddleware } from 'hono/factory'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key)
  }
}, 60_000)

/**
 * Simple in-memory rate limiter.
 * @param windowMs — Time window in milliseconds
 * @param maxRequests — Max requests per window per IP
 */
export function rateLimit(windowMs: number, maxRequests: number) {
  return createMiddleware(async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'

    const key = `${ip}:${c.req.path}`
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    c.header('RateLimit-Limit', String(maxRequests))
    c.header('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)))
    c.header('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > maxRequests) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return c.json(
        { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
        429
      )
    }

    await next()
  })
}

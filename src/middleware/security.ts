import { createMiddleware } from 'hono/factory'

/**
 * Security headers middleware following MPP best practices:
 * - Cache-Control: no-store on 402 responses (challenges must not be cached)
 * - Cache-Control: private on responses with Payment-Receipt
 * - Never expose internal errors or payment credentials in responses
 * - Standard security headers
 */
export const securityHeaders = createMiddleware(async (c, next) => {
  await next()

  // Only set headers on responses we control — skip raw mppx Response objects
  // (mppx already sets correct Cache-Control on 402 challenges)
  if (c.res.status !== 402) {
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

    if (c.res.headers.get('Payment-Receipt')) {
      c.header('Cache-Control', 'private')
    }
  }
})

/**
 * Request size limiter to prevent abuse.
 * OpenAI's max request size is ~4MB for most endpoints.
 */
export function maxBodySize(maxBytes: number) {
  return createMiddleware(async (c, next) => {
    const contentLength = c.req.header('content-length')
    if (contentLength && parseInt(contentLength) > maxBytes) {
      return c.json(
        { error: { message: `Request body too large. Max: ${maxBytes} bytes`, type: 'invalid_request_error' } },
        413
      )
    }
    await next()
  })
}

/**
 * Request ID middleware for tracing.
 */
export const requestId = createMiddleware(async (c, next) => {
  const id = c.req.header('x-request-id') || crypto.randomUUID()
  c.set('requestId' as never, id)
  await next()
  // Only set on non-402 responses to avoid touching mppx Response headers
  if (c.res.status !== 402) {
    c.header('X-Request-ID', id)
  }
})

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { config, validateConfig } from './config'
import { initPlatform, getPlatformAddress, getPlatformPublicKey } from './crypto/platform'
import { getDb } from './db/client'
import { initMppx } from './mpp/setup'
import { startPricingRefresh } from './pricing/fetcher'
import { startHealthMonitor } from './health/monitor'
import { marketplace } from './marketplace/router'
import { proxy } from './proxy/router'
import { codex } from './proxy/codex-router'
import { securityHeaders, maxBodySize, requestId } from './middleware/security'
import { rateLimit } from './middleware/rate-limit'
import { idempotency } from './middleware/idempotency'

// --- Bootstrap ---
validateConfig()
initPlatform()
console.log(`[platform] Wallet address: ${getPlatformAddress()}`)
console.log(`[platform] Public key (ECIES): ${getPlatformPublicKey()}`)

getDb()
console.log(`[db] Ready at ${config.databasePath}`)

initMppx()

startPricingRefresh()
startHealthMonitor()

// --- App ---
const app = new Hono()

// Global middleware
app.use('*', requestId)
app.use('*', securityHeaders)
app.use('*', cors())
app.use('*', logger())
app.use('*', idempotency)

// Rate limiting: marketplace gets tighter limits, proxy is more generous
app.use('/marketplace/*', rateLimit(60_000, 60))   // 60 req/min for seller management
app.use('/v1/*', rateLimit(60_000, 300))            // 300 req/min for proxy
app.use('/v1/*', maxBodySize(4 * 1024 * 1024))      // 4MB max body for proxy
app.use('/codex/*', rateLimit(60_000, 300))          // 300 req/min for codex
app.use('/codex/*', maxBodySize(4 * 1024 * 1024))    // 4MB max body for codex

// Health check
app.get('/', (c) =>
  c.json({
    name: 'UnstoppableMPP',
    status: 'running',
    version: '1.0.0',
    platform_address: getPlatformAddress(),
    public_key: getPlatformPublicKey(),
    platform_fee_pct: config.platformFeePct,
  })
)

// Marketplace routes (seller management)
app.route('/marketplace', marketplace)

// Codex routes (OpenAI Responses API, MPP-gated)
app.route('/codex', codex)

// Proxy routes (OpenAI-compatible, MPP-gated)
app.route('/', proxy)

// Global error handler — never leak internals or credentials
app.onError((err, c) => {
  // Log full error server-side only
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message)

  // Return sanitized error to client
  const status = 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500
  return c.json(
    {
      error: {
        message: status >= 500 ? 'Internal server error' : err.message,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
      },
    },
    status as 500
  )
})

// 404 handler
app.notFound((c) =>
  c.json(
    {
      error: {
        message: `Not found: ${c.req.method} ${c.req.path}`,
        type: 'invalid_request_error',
      },
    },
    404
  )
)

export default {
  port: config.port,
  fetch: app.fetch,
}

console.log(`[server] UnstoppableMPP running on http://localhost:${config.port}`)

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { encrypt } from 'eciesjs'

const PORT = 4321
const BASE = `http://localhost:${PORT}`
const MNEMONIC = 'test test test test test test test test test test test junk'
const OPENAI_KEY = process.env.OPENAI_API_KEY!

let serverProc: ReturnType<typeof Bun.spawn>
let sellerToken: string
let sellerId: string
let platformPublicKey: string
let apiKeyId: string

beforeAll(async () => {
  // Clean DB
  const { rmSync } = await import('node:fs')
  try { rmSync('./data/test.db') } catch {}

  // Boot server
  serverProc = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    env: {
      ...process.env,
      MNEMONIC,
      MPP_SECRET_KEY: 'e2e-test-secret-key',
      PORT: String(PORT),
      DATABASE_PATH: './data/test.db',
      PLATFORM_FEE_PCT: '5',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) break
    } catch {}
    await Bun.sleep(200)
  }
})

afterAll(() => {
  serverProc?.kill()
  const { rmSync } = require('node:fs')
  try { rmSync('./data/test.db') } catch {}
})

// ─── Platform ───

describe('Platform', () => {
  test('health check returns platform info', async () => {
    const res = await fetch(BASE)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('UnstoppableMPP')
    expect(body.status).toBe('running')
    expect(body.platform_address).toMatch(/^0x/)
    expect(body.public_key).toBeTruthy()
    expect(body.platform_fee_pct).toBe(5)
  })

  test('returns security headers', async () => {
    const res = await fetch(BASE)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  test('404 for unknown routes', async () => {
    const res = await fetch(`${BASE}/nonexistent`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('invalid_request_error')
  })
})

// ─── Marketplace: Seller Registration ───

describe('Marketplace: Registration', () => {
  test('GET /marketplace/public-key returns platform ECIES public key', async () => {
    const res = await fetch(`${BASE}/marketplace/public-key`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.public_key).toMatch(/^[0-9a-f]+$/)
    platformPublicKey = body.public_key
  })

  test('POST /marketplace/sellers registers a new seller', async () => {
    const res = await fetch(`${BASE}/marketplace/sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: '0xdead000000000000000000000000000000000001' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.auth_token).toBeTruthy()
    expect(body.public_key).toBe(platformPublicKey)
    sellerId = body.id
    sellerToken = body.auth_token
  })

  test('POST /marketplace/sellers requires wallet_address', async () => {
    const res = await fetch(`${BASE}/marketplace/sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

// ─── Marketplace: Key Management ───

describe('Marketplace: Keys', () => {
  test('POST /marketplace/keys accepts ECIES-encrypted OpenAI key', async () => {
    const encryptedKey = Buffer.from(
      encrypt(platformPublicKey, Buffer.from(OPENAI_KEY))
    ).toString('hex')

    const res = await fetch(`${BASE}/marketplace/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        encrypted_key: encryptedKey,
        spending_limit_usd: 1.0,
        markup_pct: -10,
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    apiKeyId = body.id
  })

  test('POST /marketplace/keys rejects without auth', async () => {
    const res = await fetch(`${BASE}/marketplace/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_key: 'abc' }),
    })
    expect(res.status).toBe(401)
  })

  test('GET /marketplace/keys lists keys with metadata', async () => {
    const res = await fetch(`${BASE}/marketplace/keys`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].id).toBe(apiKeyId)
    expect(body.keys[0].markupPct).toBe(-10)
    expect(body.keys[0].spendingLimitUsd).toBe(1.0)
    expect(body.keys[0].isActive).toBe(true)
    expect(body.keys[0].isHealthy).toBe(true)
  })

  test('PATCH /marketplace/keys/:id updates markup', async () => {
    const res = await fetch(`${BASE}/marketplace/keys/${apiKeyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({ markup_pct: -5 }),
    })
    expect(res.status).toBe(200)
  })

  test('GET /marketplace/balance shows zero initially', async () => {
    const res = await fetch(`${BASE}/marketplace/balance`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balance).toBe(0)
  })
})

// ─── Proxy: Models ───

describe('Proxy: /v1/models', () => {
  test('GET /v1/models returns model list (free, no payment)', async () => {
    const res = await fetch(`${BASE}/v1/models`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toBeInstanceOf(Array)
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0].id).toBeTruthy()
  })
})

// ─── Proxy: 402 Challenge ───

describe('Proxy: MPP 402 Flow', () => {
  test('POST /v1/chat/completions returns 402 without payment', async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'say hi' }],
      }),
    })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.type).toContain('payment-required')
    expect(body.challengeId).toBeTruthy()

    // Check WWW-Authenticate header
    const wwwAuth = res.headers.get('www-authenticate')
    expect(wwwAuth).toContain('Payment')
    expect(wwwAuth).toContain('tempo')
    expect(wwwAuth).toContain('charge')
  })

  test('POST /v1/embeddings returns 402 without payment', async () => {
    const res = await fetch(`${BASE}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'test',
      }),
    })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.type).toContain('payment-required')
  })

  test('402 challenge includes Cache-Control: no-store', async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.status).toBe(402)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})

// ─── Proxy: Direct forwarding test (bypassing MPP for validation) ───

describe('Proxy: OpenAI Integration', () => {
  test('real OpenAI key works via direct API call', async () => {
    // Verify the key itself works before testing our proxy
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
        max_tokens: 10,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.choices[0].message.content).toContain('PONG')
  })
})

// ─── Rate Limiting ───

describe('Rate Limiting', () => {
  test('marketplace endpoints return RateLimit headers', async () => {
    const res = await fetch(`${BASE}/marketplace/public-key`)
    expect(res.headers.get('ratelimit-limit')).toBe('60')
    expect(res.headers.get('ratelimit-remaining')).toBeTruthy()
    expect(res.headers.get('ratelimit-reset')).toBeTruthy()
  })
})

// ─── Payout ───

describe('Payout', () => {
  test('POST /marketplace/payout fails with zero balance', async () => {
    const res = await fetch(`${BASE}/marketplace/payout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('No balance')
  })

  test('GET /marketplace/payouts returns empty history', async () => {
    const res = await fetch(`${BASE}/marketplace/payouts`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payouts).toEqual([])
  })
})

// ─── Health Monitor ───

describe('Health Monitor', () => {
  test('key health check marks real key as healthy', async () => {
    // Wait a moment for the health monitor to run
    await Bun.sleep(2000)

    const res = await fetch(`${BASE}/marketplace/keys`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    const body = await res.json()
    // The real OpenAI key should be marked healthy after the monitor runs
    expect(body.keys[0].isHealthy).toBe(true)
  })
})

// ─── Key Deactivation ───

describe('Key Lifecycle', () => {
  test('DELETE /marketplace/keys/:id deactivates key', async () => {
    const res = await fetch(`${BASE}/marketplace/keys/${apiKeyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    expect(res.status).toBe(200)

    // Verify it's deactivated
    const listRes = await fetch(`${BASE}/marketplace/keys`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    const body = await listRes.json()
    expect(body.keys[0].isActive).toBe(false)
  })

  test('proxy returns 503 when no active keys', async () => {
    const res = await fetch(`${BASE}/v1/models`)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.message).toContain('No API keys')
  })
})

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { encrypt } from 'eciesjs'
import { privateKeyToAccount } from 'viem/accounts'

const PORT = 4321
const BASE = `http://localhost:${PORT}`
const MNEMONIC = 'test test test test test test test test test test test junk'
const OPENAI_KEY = process.env.OPENAI_API_KEY!

// Create a test wallet for seller auth
const testAccount = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

let serverProc: ReturnType<typeof Bun.spawn>
let sessionToken: string
let platformPublicKey: string
let apiKeyId: string

beforeAll(async () => {
  const { rmSync } = await import('node:fs')
  try { rmSync('./data/test.db') } catch {}

  serverProc = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    env: {
      ...process.env,
      MNEMONIC,
      MPP_SECRET_KEY: 'e2e-test-secret-key',
      PORT: String(PORT),
      DATABASE_PATH: './data/test.db',
      PLATFORM_FEE_PCT: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

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

// --- Platform ---

describe('Platform', () => {
  test('health check returns platform info', async () => {
    const res = await fetch(BASE)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('UnstoppableMPP')
    expect(body.status).toBe('running')
    expect(body.platform_address).toMatch(/^0x/)
    expect(body.public_key).toBeTruthy()
    expect(body.platform_fee_pct).toBe(1)
  })

  test('returns security headers', async () => {
    const res = await fetch(BASE)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
  })

  test('404 for unknown routes', async () => {
    const res = await fetch(`${BASE}/nonexistent`)
    expect(res.status).toBe(404)
  })
})

// --- Auth: Wallet Signature ---

describe('Auth', () => {
  test('GET /marketplace/public-key returns ECIES public key', async () => {
    const res = await fetch(`${BASE}/marketplace/public-key`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.public_key).toMatch(/^[0-9a-f]+$/)
    platformPublicKey = body.public_key
  })

  test('POST /auth/nonce returns a nonce and message to sign', async () => {
    const res = await fetch(`${BASE}/marketplace/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: testAccount.address }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nonce).toBeTruthy()
    expect(body.message).toContain('UnstoppableMPP')
    expect(body.message).toContain(body.nonce)
  })

  test('POST /auth/verify issues session token on valid signature', async () => {
    // Get nonce
    const nonceRes = await fetch(`${BASE}/marketplace/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: testAccount.address }),
    })
    const { nonce, message } = await nonceRes.json()

    // Sign
    const signature = await testAccount.signMessage({ message })

    // Verify
    const verifyRes = await fetch(`${BASE}/marketplace/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: testAccount.address, signature, nonce }),
    })
    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json()
    expect(body.token).toBeTruthy()
    expect(body.address).toBe(testAccount.address.toLowerCase())
    sessionToken = body.token
  })

  test('rejects invalid signature', async () => {
    const nonceRes = await fetch(`${BASE}/marketplace/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: testAccount.address }),
    })
    const { nonce } = await nonceRes.json()

    const res = await fetch(`${BASE}/marketplace/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: testAccount.address, signature: '0xdead', nonce }),
    })
    expect(res.status).toBe(401)
  })

  test('rejects requests without session token', async () => {
    const res = await fetch(`${BASE}/marketplace/keys`)
    expect(res.status).toBe(401)
  })
})

// --- Key Management ---

describe('Key Management', () => {
  test('POST /marketplace/keys accepts encrypted key', async () => {
    const encryptedKey = Buffer.from(
      encrypt(platformPublicKey, Buffer.from(OPENAI_KEY))
    ).toString('hex')

    const res = await fetch(`${BASE}/marketplace/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
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

  test('GET /marketplace/keys lists keys', async () => {
    const res = await fetch(`${BASE}/marketplace/keys`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].id).toBe(apiKeyId)
    expect(body.keys[0].markupPct).toBe(-10)
    expect(body.keys[0].isActive).toBe(true)
  })

  test('GET /marketplace/balance shows zero initially', async () => {
    const res = await fetch(`${BASE}/marketplace/balance`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balance).toBe(0)
  })
})

// --- Proxy ---

describe('Proxy', () => {
  test('GET /v1/models returns model list (free)', async () => {
    const res = await fetch(`${BASE}/v1/models`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toBeInstanceOf(Array)
    expect(body.data.length).toBeGreaterThan(0)
  })

  test('POST /v1/chat/completions returns 402 without payment', async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: 'say hi' }],
      }),
    })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.type).toContain('payment-required')

    const wwwAuth = res.headers.get('www-authenticate')
    expect(wwwAuth).toContain('Payment')
    expect(wwwAuth).toContain('tempo')
  })
})

// --- Rate Limiting ---

describe('Rate Limiting', () => {
  test('marketplace endpoints return RateLimit headers', async () => {
    const res = await fetch(`${BASE}/marketplace/public-key`)
    expect(res.headers.get('ratelimit-limit')).toBe('60')
  })
})

// --- Payout ---

describe('Payout', () => {
  test('fails with zero balance', async () => {
    const res = await fetch(`${BASE}/marketplace/payout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('No balance')
  })
})

// --- Delist ---

describe('Key Delisting', () => {
  test('DELETE /marketplace/keys/:id delists key', async () => {
    const res = await fetch(`${BASE}/marketplace/keys/${apiKeyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Key delisted')
  })

  test('delisted key shows as inactive', async () => {
    const res = await fetch(`${BASE}/marketplace/keys`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    const body = await res.json()
    expect(body.keys[0].isActive).toBe(false)
  })

  test('proxy returns 503 when no active keys', async () => {
    const res = await fetch(`${BASE}/v1/models`)
    expect(res.status).toBe(503)
  })
})

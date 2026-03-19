/**
 * Local sidecar proxy for Codex CLI → UnstoppableMPP.
 *
 * Runs on localhost and handles MPP payment sessions transparently.
 * Codex CLI connects here as if it were a standard OpenAI-compatible endpoint,
 * and this proxy handles the 402 challenge/voucher dance with the remote
 * UnstoppableMPP server.
 *
 * Usage:
 *   PRIVATE_KEY=0x... UNSTOPPABLE_URL=https://mpp.autonymlabs.org bun run src/sidecar/codex-proxy.ts
 *
 * Then configure Codex:
 *   ~/.codex/config.toml:
 *     [model_providers.unstoppable]
 *     name = "UnstoppableMPP"
 *     base_url = "http://localhost:4111"
 *     env_key = "UNSTOPPABLE_DUMMY"
 *     wire_api = "responses"
 */
import { Mppx, session } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex
const UNSTOPPABLE_URL = process.env.UNSTOPPABLE_URL || 'https://mpp.autonymlabs.org'
const PORT = Number(process.env.SIDECAR_PORT || 4111)
const MAX_DEPOSIT = process.env.MAX_DEPOSIT || '10' // Max USDC to deposit into channel

if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY is required (hex-encoded private key for your Tempo wallet)')
  process.exit(1)
}

const account = privateKeyToAccount(PRIVATE_KEY)
console.log(`[sidecar] Wallet: ${account.address}`)
console.log(`[sidecar] Server: ${UNSTOPPABLE_URL}`)
console.log(`[sidecar] Max deposit: ${MAX_DEPOSIT} USDC`)

// Create MPP client with session method — handles 402 automatically.
// The session method opens a payment channel, signs vouchers, and tops up
// as needed. The `deposit` / `maxDeposit` controls how much USDC to lock.
const mppx = Mppx.create({
  methods: [
    session({
      account,
      maxDeposit: MAX_DEPOSIT,
      decimals: 6,
    }),
  ],
  polyfill: false, // Don't replace globalThis.fetch
})

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // Health check
    if (path === '/' && req.method === 'GET') {
      return Response.json({
        name: 'UnstoppableMPP Codex Sidecar',
        status: 'running',
        wallet: account.address,
        server: UNSTOPPABLE_URL,
      })
    }

    // Proxy /v1/responses → remote /codex/responses
    if (path === '/v1/responses' && req.method === 'POST') {
      return proxyResponses(req)
    }

    // Pass through other /v1/* requests (e.g., /v1/models)
    if (path.startsWith('/v1/')) {
      return proxyPassthrough(req, path)
    }

    return Response.json(
      { error: { message: `Not found: ${req.method} ${path}`, type: 'invalid_request_error' } },
      { status: 404 }
    )
  },
})

console.log(`[sidecar] Listening on http://localhost:${PORT}`)
console.log(`[sidecar] Configure Codex with base_url = "http://localhost:${PORT}"`)

/**
 * Proxy a Codex Responses API request through the MPP session.
 * mppx.fetch handles 402 challenges, channel opens, and vouchers automatically.
 * For SSE streaming, we proxy the raw stream through to Codex after mppx
 * has handled the payment handshake.
 */
async function proxyResponses(req: Request): Promise<Response> {
  const body = await req.text()
  const upstreamUrl = `${UNSTOPPABLE_URL}/codex/responses`

  try {
    const response = await mppx.fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body,
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[sidecar] Upstream error ${response.status}:`, errText)
      return new Response(errText, {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
      })
    }

    if (!response.body) {
      return Response.json(
        { type: 'error', error: { message: 'No response body', type: 'server_error' } },
        { status: 502 }
      )
    }

    // The upstream response is an SSE stream. We need to pass it through
    // but filter out any mppx-specific events (payment-need-voucher, payment-receipt)
    // so Codex only sees standard OpenAI Responses API events.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        const filtered: string[] = []
        let skipNextData = false

        for (const line of lines) {
          // Skip mppx-specific SSE events
          if (line.startsWith('event: payment-need-voucher') || line.startsWith('event: payment-receipt')) {
            skipNextData = true
            continue
          }
          if (skipNextData && line.startsWith('data:')) {
            skipNextData = false
            continue
          }
          skipNextData = false
          filtered.push(line)
        }

        const output = filtered.join('\n')
        if (output.trim()) {
          controller.enqueue(new TextEncoder().encode(output))
        }
      },
    })

    response.body.pipeTo(writable).catch(() => { /* stream interrupted */ })

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[sidecar] Proxy error:', err instanceof Error ? err.message : err)
    return Response.json(
      {
        type: 'error',
        error: {
          message: err instanceof Error ? err.message : 'Proxy error',
          type: 'server_error',
          code: 'proxy_error',
        },
      },
      { status: 502 }
    )
  }
}

/**
 * Pass-through proxy for non-paid endpoints (e.g., /v1/models).
 */
async function proxyPassthrough(req: Request, path: string): Promise<Response> {
  const upstreamUrl = `${UNSTOPPABLE_URL}${path}`
  try {
    const response = await mppx.fetch(upstreamUrl, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' ? await req.text() : undefined,
    })
    return response
  } catch (err) {
    console.error('[sidecar] Passthrough error:', err instanceof Error ? err.message : err)
    return Response.json(
      { error: { message: 'Upstream error', type: 'server_error' } },
      { status: 502 }
    )
  }
}

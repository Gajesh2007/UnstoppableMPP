/**
 * Local sidecar proxy for Codex CLI → UnstoppableMPP.
 *
 * Runs on localhost and handles MPP payment sessions transparently.
 * Codex CLI connects here as if it were a standard OpenAI-compatible endpoint.
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run sidecar
 *
 * Or auto-reads from ~/.tempo/wallet/keys.toml if available.
 *
 * Then configure Codex (~/.codex/config.toml):
 *   [model_providers.unstoppable]
 *   name = "UnstoppableMPP"
 *   base_url = "http://localhost:4111"
 *   env_key = "UNSTOPPABLE_DUMMY"
 *   wire_api = "responses"
 */
import { Mppx, session } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Hex } from 'viem'

const UNSTOPPABLE_URL = process.env.UNSTOPPABLE_URL || 'https://mpp.autonymlabs.org'
const PORT = Number(process.env.SIDECAR_PORT || 4111)
const MAX_DEPOSIT = process.env.MAX_DEPOSIT || '5'

function loadPrivateKey(): Hex {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY as Hex
  try {
    const toml = readFileSync(join(homedir(), '.tempo', 'wallet', 'keys.toml'), 'utf8')
    const match = toml.match(/^key\s*=\s*"(0x[0-9a-fA-F]+)"/m)
    if (match) {
      console.log('[sidecar] Loaded key from Tempo wallet')
      return match[1] as Hex
    }
  } catch { /* not found */ }
  console.error('Set PRIVATE_KEY=0x... or run `tempo wallet login`')
  process.exit(1)
}

const account = privateKeyToAccount(loadPrivateKey())
console.log(`[sidecar] Wallet: ${account.address}`)
console.log(`[sidecar] Server: ${UNSTOPPABLE_URL}`)

const mppx = Mppx.create({
  methods: [session({ account, maxDeposit: MAX_DEPOSIT, decimals: 6 })],
  polyfill: false,
})

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/' && req.method === 'GET') {
      return Response.json({ name: 'UnstoppableMPP Codex Sidecar', status: 'running', wallet: account.address, server: UNSTOPPABLE_URL })
    }

    // Codex CLI hits /responses (base_url + /responses)
    if ((path === '/responses' || path === '/v1/responses') && req.method === 'POST') {
      return proxyCodex(req)
    }

    if (path.startsWith('/v1/')) {
      return proxyPassthrough(req, path)
    }

    return Response.json({ error: { message: `Not found: ${req.method} ${path}`, type: 'invalid_request_error' } }, { status: 404 })
  },
})

console.log(`[sidecar] Listening on http://localhost:${PORT}`)

/**
 * Proxy Codex requests. Pays via mppx session, then streams SSE through.
 */
async function proxyCodex(req: Request): Promise<Response> {
  const body = await req.text()

  // First: make the paid request (non-streaming) to establish payment
  // Then: make a streaming request using the same session
  // Actually: mppx.fetch handles the 402 dance. We send stream:true
  // and the server streams SSE. mppx.fetch handles payment on the first
  // request, subsequent requests reuse the channel.
  try {
    console.log('[sidecar] Sending request to', `${UNSTOPPABLE_URL}/codex/responses`)
    const response = await mppx.fetch(`${UNSTOPPABLE_URL}/codex/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body,
    })

    console.log('[sidecar] Response:', response.status, response.headers.get('content-type'))

    if (!response.ok) {
      const err = await response.text()
      console.error(`[sidecar] Upstream ${response.status}:`, err.slice(0, 500))
      return new Response(err || JSON.stringify({ error: { message: `Upstream ${response.status}`, type: 'server_error' } }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!response.body) {
      return Response.json({ type: 'error', error: { message: 'No response body', type: 'server_error' } }, { status: 502 })
    }

    // Filter out mppx payment events, pass through OpenAI events
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        const filtered: string[] = []
        let skip = false
        for (const line of lines) {
          if (line.startsWith('event: payment-need-voucher') || line.startsWith('event: payment-receipt')) {
            skip = true
            continue
          }
          if (skip && line.startsWith('data:')) { skip = false; continue }
          skip = false
          filtered.push(line)
        }
        const out = filtered.join('\n')
        if (out.trim()) controller.enqueue(new TextEncoder().encode(out))
      },
    })

    response.body.pipeTo(writable).catch(() => {})

    return new Response(readable, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    })
  } catch (err: any) {
    console.error('[sidecar] Error:', err?.message || err)
    if (err?.cause) console.error('[sidecar] Cause:', err.cause?.message || err.cause)
    if (err?.stack) console.error('[sidecar] Stack:', err.stack)
    return Response.json({ type: 'error', error: { message: err instanceof Error ? err.message : 'Proxy error', type: 'server_error' } }, { status: 502 })
  }
}

async function proxyPassthrough(req: Request, path: string): Promise<Response> {
  try {
    return await mppx.fetch(`${UNSTOPPABLE_URL}${path}`, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' ? await req.text() : undefined,
    })
  } catch (err) {
    return Response.json({ error: { message: 'Upstream error', type: 'server_error' } }, { status: 502 })
  }
}

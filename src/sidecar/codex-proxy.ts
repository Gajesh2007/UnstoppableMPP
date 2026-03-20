/**
 * Local sidecar proxy for Codex CLI → UnstoppableMPP.
 *
 * Runs on localhost and handles MPP payment sessions transparently.
 * Codex CLI connects here as if it were a standard OpenAI-compatible endpoint,
 * and this proxy handles the 402 challenge/voucher dance with the remote
 * UnstoppableMPP server.
 *
 * Reads your Tempo wallet key automatically from ~/.tempo/wallet/keys.toml.
 * Just run `tempo wallet login` first if you haven't already.
 *
 * Usage:
 *   bun run sidecar
 *
 * Or with a custom private key:
 *   PRIVATE_KEY=0x... bun run sidecar
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
import { join } from 'node:path'
import { homedir } from 'node:os'

const UNSTOPPABLE_URL = process.env.UNSTOPPABLE_URL || 'https://mpp.autonymlabs.org'
const PORT = Number(process.env.SIDECAR_PORT || 4111)
const MAX_DEPOSIT = process.env.MAX_DEPOSIT || '10'

/**
 * Load the signing key — either from PRIVATE_KEY env or from Tempo wallet.
 */
function loadPrivateKey(): Hex {
  if (process.env.PRIVATE_KEY) {
    return process.env.PRIVATE_KEY as Hex
  }

  // Read from Tempo wallet (~/.tempo/wallet/keys.toml)
  const keysPath = join(homedir(), '.tempo', 'wallet', 'keys.toml')
  try {
    const toml = require('fs').readFileSync(keysPath, 'utf8')
    const match = toml.match(/^key\s*=\s*"(0x[0-9a-fA-F]+)"/m)
    if (match) {
      console.log('[sidecar] Loaded key from Tempo wallet')
      return match[1] as Hex
    }
  } catch { /* not found */ }

  console.error(
    'No private key found.\n\n' +
    'Either:\n' +
    '  1. Run `tempo wallet login` to set up your Tempo wallet, or\n' +
    '  2. Set PRIVATE_KEY=0x... environment variable\n'
  )
  process.exit(1)
}

const privateKey = loadPrivateKey()
const account = privateKeyToAccount(privateKey)
console.log(`[sidecar] Wallet: ${account.address}`)
console.log(`[sidecar] Server: ${UNSTOPPABLE_URL}`)
console.log(`[sidecar] Max deposit: ${MAX_DEPOSIT} USDC`)

const mppx = Mppx.create({
  methods: [
    session({
      account,
      maxDeposit: MAX_DEPOSIT,
      decimals: 6,
    }),
  ],
})

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

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

    // Pass through other /v1/* requests
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

    // Filter out mppx-specific SSE events so Codex only sees OpenAI events
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        const filtered: string[] = []
        let skipNextData = false

        for (const line of lines) {
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
      { type: 'error', error: { message: err instanceof Error ? err.message : 'Proxy error', type: 'server_error' } },
      { status: 502 }
    )
  }
}

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

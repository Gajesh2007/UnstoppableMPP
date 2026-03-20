/**
 * Local sidecar proxy for Codex CLI → UnstoppableMPP.
 *
 * Runs on localhost and handles MPP payment sessions transparently
 * using the Tempo CLI. Codex CLI connects here as if it were a
 * standard OpenAI-compatible endpoint.
 *
 * Prerequisites:
 *   1. Install Tempo CLI: curl -sSL https://tempo.xyz/install | bash
 *   2. Login: tempo wallet login
 *   3. Fund: tempo wallet fund
 *
 * Usage:
 *   bun run sidecar
 *
 * Then configure Codex (~/.codex/config.toml):
 *   [model_providers.unstoppable]
 *   name = "UnstoppableMPP"
 *   base_url = "http://localhost:4111"
 *   env_key = "UNSTOPPABLE_DUMMY"
 *   wire_api = "responses"
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

const UNSTOPPABLE_URL = process.env.UNSTOPPABLE_URL || 'https://mpp.autonymlabs.org'
const PORT = Number(process.env.SIDECAR_PORT || 4111)

// Find tempo binary
const tempoBin = join(homedir(), '.tempo', 'bin', 'tempo')
if (!existsSync(tempoBin)) {
  console.error(
    'Tempo CLI not found.\n\n' +
    'Install it:\n' +
    '  curl -sSL https://tempo.xyz/install | bash\n' +
    '  tempo wallet login\n' +
    '  tempo wallet fund\n'
  )
  process.exit(1)
}

console.log(`[sidecar] Tempo CLI: ${tempoBin}`)
console.log(`[sidecar] Server: ${UNSTOPPABLE_URL}`)

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/' && req.method === 'GET') {
      return Response.json({
        name: 'UnstoppableMPP Codex Sidecar',
        status: 'running',
        server: UNSTOPPABLE_URL,
      })
    }

    // Proxy /v1/responses → remote /codex/responses
    if (path === '/v1/responses' && req.method === 'POST') {
      return proxyViaTempoRequest(req, `${UNSTOPPABLE_URL}/codex/responses`)
    }

    // Pass through other /v1/* requests
    if (path.startsWith('/v1/')) {
      return proxyViaTempoRequest(req, `${UNSTOPPABLE_URL}${path}`)
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
 * Proxy a request using `tempo request` for automatic payment handling.
 * Supports the Tempo passkey wallet — no raw private keys needed.
 */
async function proxyViaTempoRequest(req: Request, upstreamUrl: string): Promise<Response> {
  const body = await req.text()

  const args = [
    'request', '-t',
    '-X', req.method,
    '-H', 'Content-Type: application/json',
    '--json', body,
    upstreamUrl,
  ]

  try {
    const proc = Bun.spawn([tempoBin, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited

    if (exitCode !== 0) {
      console.error(`[sidecar] tempo request failed (exit ${exitCode}):`, stderr || stdout)
      return Response.json(
        { type: 'error', error: { message: stderr || stdout || 'Payment failed', type: 'server_error' } },
        { status: 502 }
      )
    }

    // tempo request outputs the response body to stdout
    // Detect if it's JSON or something else
    const trimmed = stdout.trim()
    const isJson = trimmed.startsWith('{') || trimmed.startsWith('[')

    return new Response(stdout, {
      status: 200,
      headers: {
        'Content-Type': isJson ? 'application/json' : 'text/plain',
      },
    })
  } catch (err) {
    console.error('[sidecar] Error:', err instanceof Error ? err.message : err)
    return Response.json(
      { type: 'error', error: { message: err instanceof Error ? err.message : 'Proxy error', type: 'server_error' } },
      { status: 502 }
    )
  }
}

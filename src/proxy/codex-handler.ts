import { nanoid } from 'nanoid'
import { getDb } from '../db/client'
import { transactions, sellers } from '../db/schema'
import {
  selectNextCodexToken,
  markCodexTokenFailure,
  markCodexTokenSuccess,
  type SelectedCodexToken,
} from './codex-token-selector'
import { splitPayment } from '../pricing/calculator'
import { getModelPricing } from '../pricing/fetcher'
import { refreshCodexToken } from '../marketplace/codex-oauth'
import { sql, eq } from 'drizzle-orm'

const MAX_RETRIES = 3
const CHATGPT_CODEX_BASE = 'https://chatgpt.com/backend-api/codex'

/** Full usage breakdown from response.completed */
interface CodexUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
}

function parseUsage(u: Record<string, unknown>): CodexUsage {
  return {
    inputTokens: (u.input_tokens as number) || 0,
    cachedInputTokens: (u.input_tokens_details as Record<string, number>)?.cached_tokens || 0,
    outputTokens: (u.output_tokens as number) || 0,
    reasoningTokens: (u.output_tokens_details as Record<string, number>)?.reasoning_tokens || 0,
  }
}

/**
 * Fetch from ChatGPT Codex upstream with retry + token fallback.
 * Always streams from upstream (ChatGPT requires it).
 * Returns the upstream Response and the token used.
 */
async function fetchUpstream(
  headers: Headers,
  body: Record<string, unknown>,
  initialToken: SelectedCodexToken
): Promise<{ response: Response; token: SelectedCodexToken } | Response> {
  const excludeIds: string[] = []
  let token = initialToken

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      try {
        token = await selectNextCodexToken(excludeIds)
      } catch {
        return errorResponse(503, 'No Codex tokens available')
      }
    }

    const upstreamHeaders = new Headers()
    upstreamHeaders.set('Authorization', `Bearer ${token.accessToken}`)
    upstreamHeaders.set('ChatGPT-Account-ID', token.accountId)
    upstreamHeaders.set('Content-Type', 'application/json')
    upstreamHeaders.set('Accept', 'text/event-stream')

    for (const name of ['user-agent', 'accept-encoding']) {
      const val = headers.get(name)
      if (val) upstreamHeaders.set(name, val)
    }

    // ChatGPT Codex requires store: false and stream: true
    const upstreamBody = { ...body, store: false, stream: true }

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(`${CHATGPT_CODEX_BASE}/responses`, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
      })
    } catch (err) {
      console.error(`[codex] Network error with token ${token.id}:`, err instanceof Error ? err.message : err)
      excludeIds.push(token.id)
      await markCodexTokenFailure(token.id)
      continue
    }

    if (upstreamResponse.status === 401 && attempt === 0) {
      console.log(`[codex] Token ${token.id} got 401, attempting refresh...`)
      const refreshed = await refreshCodexToken(token.id)
      if (refreshed) {
        attempt--
        continue
      }
    }

    if (upstreamResponse.status === 401 || upstreamResponse.status === 403 || upstreamResponse.status === 429) {
      excludeIds.push(token.id)
      await markCodexTokenFailure(token.id)
      continue
    }

    if (!upstreamResponse.body) {
      return errorResponse(502, 'No response body from upstream')
    }

    await markCodexTokenSuccess(token.id)
    return { response: upstreamResponse, token }
  }

  return errorResponse(503, 'All available Codex tokens failed')
}

/**
 * Streaming proxy: pass SSE through to the buyer, extract usage at the end.
 */
export async function proxyCodexStreaming(
  headers: Headers,
  body: Record<string, unknown>,
  initialToken: SelectedCodexToken
): Promise<Response> {
  const result = await fetchUpstream(headers, body, initialToken)
  if (result instanceof Response) return result
  const { response: upstreamResponse, token } = result

  const model = (body.model as string) || 'unknown'
  const usage: CodexUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }

  let lineBuffer = ''
  const { readable, writable } = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk)

      lineBuffer += new TextDecoder().decode(chunk)
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'response.completed' && parsed.response?.usage) {
            Object.assign(usage, parseUsage(parsed.response.usage))
          }
        } catch { /* skip */ }
      }
    },
    flush() {
      if (lineBuffer.trim()) {
        for (const line of lineBuffer.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'response.completed' && parsed.response?.usage) {
              Object.assign(usage, parseUsage(parsed.response.usage))
            }
          } catch { /* skip */ }
        }
      }
      recordCodexTransaction(token, model, usage, '/codex/responses')
        .catch((err) => console.error('[codex] Failed to record transaction:', err instanceof Error ? err.message : err))
    },
  })

  upstreamResponse.body!.pipeTo(writable).catch(() => { /* stream interrupted */ })

  return new Response(readable, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Non-streaming proxy: buffer the SSE stream server-side,
 * return the complete response as a single JSON object.
 * The buyer gets a normal API response — no SSE, no streaming.
 */
export async function proxyCodexBuffered(
  headers: Headers,
  body: Record<string, unknown>,
  initialToken: SelectedCodexToken
): Promise<Response> {
  const result = await fetchUpstream(headers, body, initialToken)
  if (result instanceof Response) return result
  const { response: upstreamResponse, token } = result

  const model = (body.model as string) || 'unknown'

  // Read the entire SSE stream, collect the final response object
  const rawText = await upstreamResponse.text()
  let completedResponse: Record<string, unknown> | null = null

  for (const line of rawText.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data)
      if (parsed.type === 'response.completed' && parsed.response) {
        completedResponse = parsed.response
      }
    } catch { /* skip */ }
  }

  if (!completedResponse) {
    return errorResponse(502, 'No response.completed event received from upstream')
  }

  // Extract usage for billing
  const usage: CodexUsage = completedResponse.usage
    ? parseUsage(completedResponse.usage as Record<string, unknown>)
    : { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }

  recordCodexTransaction(token, model, usage, '/codex/responses')
    .catch((err) => console.error('[codex] Failed to record transaction:', err instanceof Error ? err.message : err))

  // Return the complete response object — same shape as OpenAI's non-streaming Responses API
  return new Response(JSON.stringify(completedResponse), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store',
    },
  })
}

/**
 * Calculate cost exactly like OpenAI does:
 *   cost = (non-cached input × input price)
 *        + (cached input × cached price)
 *        + (output × output price)
 */
async function recordCodexTransaction(
  token: SelectedCodexToken,
  model: string,
  usage: CodexUsage,
  endpoint: string
) {
  let equivalentCostUsd = 0

  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    let pricing = await getModelPricing(model)
    if (!pricing) pricing = await getModelPricing('gpt-4o')

    const inputPrice = pricing?.inputPricePerToken || 0.00000175
    const cachedPrice = inputPrice / 10
    const outputPrice = pricing?.outputPricePerToken || 0.000014

    const nonCachedInput = usage.inputTokens - usage.cachedInputTokens
    equivalentCostUsd =
      (nonCachedInput * inputPrice) +
      (usage.cachedInputTokens * cachedPrice) +
      (usage.outputTokens * outputPrice)
  }

  const { sellerEarnedUsd, platformFeeUsd } = splitPayment(equivalentCostUsd, token.markupPct)

  const db = getDb()
  await db
    .update(sellers)
    .set({ balance: sql`${sellers.balance} + ${sellerEarnedUsd}` })
    .where(eq(sellers.id, token.sellerId))

  await db.insert(transactions).values({
    id: nanoid(),
    apiKeyId: token.id,
    sellerId: token.sellerId,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    openaiCostUsd: equivalentCostUsd,
    buyerPaidUsd: equivalentCostUsd,
    sellerEarnedUsd,
    platformFeeUsd,
    endpoint,
    createdAt: new Date(),
  })
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      type: 'error',
      error: { message, type: 'server_error', code: status === 503 ? 'service_unavailable' : 'upstream_error' },
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

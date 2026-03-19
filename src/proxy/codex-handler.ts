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

/**
 * Proxy a Codex Responses API request to ChatGPT's backend.
 * Uses seller's ChatGPT session tokens instead of OpenAI API keys.
 * ChatGPT Codex always streams — returns SSE with response.* events.
 */
export async function proxyCodexToChatGPT(
  headers: Headers,
  body: Record<string, unknown>,
  initialToken: SelectedCodexToken
): Promise<Response> {
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

    // Forward relevant headers from the Codex client
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

    // On 401, try refreshing the token once before failing over
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

    const model = (body.model as string) || 'unknown'
    const usage: CodexUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }

    // Pass through SSE events, extract full usage from response.completed.
    // Buffer incomplete lines across chunks to handle split SSE events.
    let lineBuffer = ''
    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)

        lineBuffer += new TextDecoder().decode(chunk)
        const lines = lineBuffer.split('\n')
        // Keep the last (potentially incomplete) line in the buffer
        lineBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'response.completed' && parsed.response?.usage) {
              const u = parsed.response.usage
              usage.inputTokens = u.input_tokens || 0
              usage.cachedInputTokens = u.input_tokens_details?.cached_tokens || 0
              usage.outputTokens = u.output_tokens || 0
              usage.reasoningTokens = u.output_tokens_details?.reasoning_tokens || 0
            }
          } catch { /* skip malformed lines */ }
        }
      },
      flush() {
        // Process any remaining buffered data
        if (lineBuffer.trim()) {
          const lines = lineBuffer.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'response.completed' && parsed.response?.usage) {
                const u = parsed.response.usage
                usage.inputTokens = u.input_tokens || 0
                usage.cachedInputTokens = u.input_tokens_details?.cached_tokens || 0
                usage.outputTokens = u.output_tokens || 0
                usage.reasoningTokens = u.output_tokens_details?.reasoning_tokens || 0
              }
            } catch { /* skip */ }
          }
        }
        recordCodexTransaction(token, model, usage)
          .catch((err) => console.error('[codex] Failed to record transaction:', err instanceof Error ? err.message : err))
      },
    })

    upstreamResponse.body.pipeTo(writable).catch(() => { /* stream interrupted */ })

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

  return errorResponse(503, 'All available Codex tokens failed')
}

/**
 * Calculate cost exactly like OpenAI does:
 *   cost = (non-cached input × input price)
 *        + (cached input × cached price)
 *        + (output × output price)
 *
 * Cached input is 10x cheaper than regular input.
 * Reasoning tokens are charged at output rate.
 */
async function recordCodexTransaction(
  token: SelectedCodexToken,
  model: string,
  usage: CodexUsage
) {
  let equivalentCostUsd = 0

  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    let pricing = await getModelPricing(model)
    if (!pricing) pricing = await getModelPricing('gpt-4o')

    const inputPrice = pricing?.inputPricePerToken || 0.00000175   // $1.75/1M
    const cachedPrice = inputPrice / 10                             // 10x cheaper
    const outputPrice = pricing?.outputPricePerToken || 0.000014   // $14.00/1M

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
    endpoint: '/codex/responses',
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

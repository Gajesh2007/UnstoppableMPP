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

/**
 * Proxy a Codex Responses API request to ChatGPT's backend.
 * Uses seller's ChatGPT session tokens instead of OpenAI API keys.
 * Codex always streams — returns SSE with response.* events.
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

    // ChatGPT Codex auth requires store: false
    const upstreamBody = { ...body, store: false }

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
        // Retry with refreshed token — don't count as a failure
        attempt-- // will increment back to same attempt number
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
    const isStreaming = body.stream !== false

    if (!isStreaming) {
      // Non-streaming: parse JSON response, extract usage, return as-is
      const responseBody = await upstreamResponse.text()
      let totalInputTokens = 0
      let totalOutputTokens = 0
      try {
        const parsed = JSON.parse(responseBody)
        if (parsed.usage) {
          totalInputTokens = parsed.usage.input_tokens || 0
          totalOutputTokens = parsed.usage.output_tokens || 0
        }
      } catch { /* skip */ }

      recordCodexTransaction(token, model, totalInputTokens, totalOutputTokens)
        .catch((err) => console.error('[codex] Failed to record transaction:', err instanceof Error ? err.message : err))

      return new Response(responseBody, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store',
        },
      })
    }

    // Streaming: pass through SSE events, extract usage from response.completed
    let totalInputTokens = 0
    let totalOutputTokens = 0

    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)

        const text = new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'response.completed' && parsed.response?.usage) {
              totalInputTokens = parsed.response.usage.input_tokens || 0
              totalOutputTokens = parsed.response.usage.output_tokens || 0
            }
          } catch { /* skip malformed lines */ }
        }
      },
      flush() {
        recordCodexTransaction(
          token, model, totalInputTokens, totalOutputTokens
        ).catch((err) =>
          console.error('[codex] Failed to record transaction:', err instanceof Error ? err.message : err)
        )
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

async function recordCodexTransaction(
  token: SelectedCodexToken,
  model: string,
  inputTokens: number,
  outputTokens: number
) {
  // ChatGPT subscriptions are flat-rate, so there's no real "OpenAI cost"
  // per token. We use equivalent API pricing as a basis for billing.
  // Codex models aren't on OpenRouter, so fall back to gpt-4o-equivalent pricing.
  let equivalentCostUsd: number | undefined
  if (inputTokens > 0 || outputTokens > 0) {
    let pricing = await getModelPricing(model)
    if (!pricing) pricing = await getModelPricing('gpt-4o')
    const inputPrice = pricing?.inputPricePerToken || 0.0000025
    const outputPrice = pricing?.outputPricePerToken || 0.00001
    equivalentCostUsd = inputTokens * inputPrice + outputTokens * outputPrice
  }

  const { sellerEarnedUsd, platformFeeUsd } = splitPayment(equivalentCostUsd || 0, token.markupPct)

  const db = getDb()
  await db
    .update(sellers)
    .set({ balance: sql`${sellers.balance} + ${sellerEarnedUsd}` })
    .where(eq(sellers.id, token.sellerId))

  await db.insert(transactions).values({
    id: nanoid(),
    apiKeyId: token.id, // reusing apiKeyId field for codex token ID
    sellerId: token.sellerId,
    model,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    openaiCostUsd: equivalentCostUsd,
    buyerPaidUsd: equivalentCostUsd || 0,
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

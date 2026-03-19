import { nanoid } from 'nanoid'
import { config } from '../config'
import { getDb } from '../db/client'
import { transactions, sellers } from '../db/schema'
import { selectCheapestKey, selectNextKey, recordSpend, type SelectedKey } from './key-selector'
import { splitPayment } from '../pricing/calculator'
import { getModelPricing } from '../pricing/fetcher'
import { markKeyFailure, markKeySuccess } from '../health/tracker'
import { sql, eq } from 'drizzle-orm'

const MAX_RETRIES = 3

/**
 * Proxy a streaming (SSE) request to OpenAI.
 * Streams chunks back to the buyer in real time.
 * On key failure (401/403/429), falls back to the next cheapest key.
 */
export async function proxyStreamingToOpenAI(
  path: string,
  headers: Headers,
  body: Record<string, unknown>,
  buyerPaidUsd: number
): Promise<Response> {
  const excludeKeyIds: string[] = []

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let selectedKey: SelectedKey
    try {
      selectedKey =
        excludeKeyIds.length === 0
          ? await selectCheapestKey()
          : await selectNextKey(excludeKeyIds)
    } catch {
      return errorResponse(503, 'No API keys available')
    }

    const upstreamHeaders = new Headers()
    upstreamHeaders.set('Authorization', `Bearer ${selectedKey.decryptedKey}`)
    upstreamHeaders.set('Content-Type', 'application/json')

    // Request stream_options.include_usage so OpenAI sends usage in the final chunk
    const bodyWithUsage = { ...body, stream_options: { include_usage: true } }

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(`${config.openaiBaseUrl}${path}`, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(bodyWithUsage),
      })
    } catch (err) {
      console.error(`[streaming] Network error with key ${selectedKey.id}:`, err instanceof Error ? err.message : err)
      excludeKeyIds.push(selectedKey.id)
      await markKeyFailure(selectedKey.id)
      continue
    }

    if (
      upstreamResponse.status === 401 ||
      upstreamResponse.status === 403 ||
      upstreamResponse.status === 429
    ) {
      excludeKeyIds.push(selectedKey.id)
      await markKeyFailure(selectedKey.id)
      continue
    }

    if (!upstreamResponse.body) {
      return errorResponse(502, 'No response body from upstream')
    }

    await markKeySuccess(selectedKey.id)

    const model = (body.model as string) || 'unknown'
    let totalOutputTokens = 0
    let totalInputTokens = 0

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
            // OpenAI sends usage in final chunk when stream_options.include_usage is true
            if (parsed.usage) {
              totalInputTokens = parsed.usage.prompt_tokens || 0
              totalOutputTokens = parsed.usage.completion_tokens || 0
            } else if (parsed.choices?.[0]?.delta?.content) {
              totalOutputTokens++
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      },
      flush() {
        // Record transaction async — don't block stream completion
        recordStreamTransaction(
          selectedKey, model, path, buyerPaidUsd,
          totalInputTokens, totalOutputTokens
        ).catch((err) =>
          console.error('[streaming] Failed to record transaction:', err instanceof Error ? err.message : err)
        )
      },
    })

    upstreamResponse.body.pipeTo(writable).catch(() => {
      // Stream interrupted — flush will still fire with partial data
    })

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  return errorResponse(503, 'All available API keys failed')
}

async function recordStreamTransaction(
  selectedKey: SelectedKey,
  model: string,
  path: string,
  buyerPaidUsd: number,
  inputTokens: number,
  outputTokens: number
) {
  const { sellerEarnedUsd, platformFeeUsd } = splitPayment(buyerPaidUsd, selectedKey.markupPct)

  let openaiCostUsd: number | undefined
  if (inputTokens > 0) {
    const pricing = await getModelPricing(model)
    if (pricing) {
      openaiCostUsd =
        inputTokens * pricing.inputPricePerToken +
        outputTokens * pricing.outputPricePerToken
    }
  }

  await recordSpend(selectedKey.id, openaiCostUsd || buyerPaidUsd)

  const db = getDb()
  await db
    .update(sellers)
    .set({ balance: sql`${sellers.balance} + ${sellerEarnedUsd}` })
    .where(eq(sellers.id, selectedKey.sellerId))

  await db.insert(transactions).values({
    id: nanoid(),
    apiKeyId: selectedKey.id,
    sellerId: selectedKey.sellerId,
    model,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    openaiCostUsd,
    buyerPaidUsd,
    sellerEarnedUsd,
    platformFeeUsd,
    endpoint: path,
    createdAt: new Date(),
  })
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { message, type: 'server_error' } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

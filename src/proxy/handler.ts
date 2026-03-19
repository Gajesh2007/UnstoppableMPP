import { nanoid } from 'nanoid'
import { config } from '../config'
import { getDb } from '../db/client'
import { transactions, sellers } from '../db/schema'
import { selectNextKey, recordSpend, type SelectedKey } from './key-selector'
import { splitPayment } from '../pricing/calculator'
import { getModelPricing } from '../pricing/fetcher'
import { markKeyFailure, markKeySuccess } from '../health/tracker'
import { sql, eq } from 'drizzle-orm'

const MAX_RETRIES = 3

const FORWARD_HEADERS = ['user-agent', 'accept', 'accept-encoding']
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-disposition',
  'x-request-id',
  'openai-model',
  'openai-processing-ms',
  'openai-version',
]

/**
 * Proxy a non-streaming request to OpenAI.
 * Uses the pre-selected key, falls back to next cheapest on failure.
 */
export async function proxyToOpenAI(
  method: string,
  path: string,
  headers: Headers,
  body: Record<string, unknown> | null,
  initialKey: SelectedKey
): Promise<Response> {
  const excludeKeyIds: string[] = []
  let selectedKey = initialKey

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      try {
        selectedKey = await selectNextKey(excludeKeyIds)
      } catch {
        return errorResponse(503, 'No API keys available')
      }
    }

    const upstreamHeaders = new Headers()
    upstreamHeaders.set('Authorization', `Bearer ${selectedKey.decryptedKey}`)
    upstreamHeaders.set('Content-Type', 'application/json')

    for (const name of FORWARD_HEADERS) {
      const val = headers.get(name)
      if (val) upstreamHeaders.set(name, val)
    }

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(`${config.openaiBaseUrl}${path}`, {
        method,
        headers: upstreamHeaders,
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      console.error(`[proxy] Network error with key ${selectedKey.id}:`, err instanceof Error ? err.message : err)
      excludeKeyIds.push(selectedKey.id)
      await markKeyFailure(selectedKey.id)
      continue
    }

    if (upstreamResponse.status === 401 || upstreamResponse.status === 403 || upstreamResponse.status === 429) {
      excludeKeyIds.push(selectedKey.id)
      await markKeyFailure(selectedKey.id)
      continue
    }

    await markKeySuccess(selectedKey.id)

    const contentType = upstreamResponse.headers.get('Content-Type') || ''
    let responseText: string | null = null
    let responseBody: Record<string, unknown> | null = null

    if (contentType.includes('application/json')) {
      responseText = await upstreamResponse.text()
      try {
        responseBody = JSON.parse(responseText)
      } catch { /* pass through */ }
    }

    // Record transaction async
    recordTransaction(selectedKey, body, responseBody, path).catch((err) =>
      console.error('[proxy] Failed to record transaction:', err instanceof Error ? err.message : err)
    )

    const responseHeaders = new Headers()
    for (const name of PASSTHROUGH_HEADERS) {
      const val = upstreamResponse.headers.get(name)
      if (val) responseHeaders.set(name, val)
    }

    if (responseText !== null) {
      return new Response(responseText, { status: upstreamResponse.status, headers: responseHeaders })
    }

    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders })
  }

  return errorResponse(503, 'All available API keys failed')
}

async function recordTransaction(
  selectedKey: SelectedKey,
  requestBody: Record<string, unknown> | null,
  responseBody: Record<string, unknown> | null,
  path: string
) {
  const model = (requestBody?.model as string) || 'unknown'
  const usage = responseBody?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined

  let openaiCostUsd: number | undefined
  if (usage?.prompt_tokens !== undefined) {
    const pricing = await getModelPricing(model)
    if (pricing) {
      openaiCostUsd =
        (usage.prompt_tokens || 0) * pricing.inputPricePerToken +
        (usage.completion_tokens || 0) * pricing.outputPricePerToken
    }
  }

  await recordSpend(selectedKey.id, openaiCostUsd || 0)

  const { sellerEarnedUsd, platformFeeUsd } = splitPayment(openaiCostUsd || 0, selectedKey.markupPct)

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
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    openaiCostUsd,
    buyerPaidUsd: openaiCostUsd || 0,
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

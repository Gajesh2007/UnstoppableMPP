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

// DALL-E pricing per image (USD)
const IMAGE_PRICING: Record<string, Record<string, Record<string, number>>> = {
  'dall-e-3': {
    standard: { '1024x1024': 0.04, '1024x1792': 0.08, '1792x1024': 0.08 },
    hd:       { '1024x1024': 0.08, '1024x1792': 0.12, '1792x1024': 0.12 },
  },
  'dall-e-2': {
    standard: { '1024x1024': 0.02, '512x512': 0.018, '256x256': 0.016 },
  },
  'gpt-image-1': {
    standard: { '1024x1024': 0.04, '1024x1536': 0.08, '1536x1024': 0.08 },
    hd:       { '1024x1024': 0.08, '1024x1536': 0.16, '1536x1024': 0.16 },
  },
}

function getImageCost(
  model: string,
  quality: string,
  size: string,
  numImages: number
): number {
  const modelPricing = IMAGE_PRICING[model]
  if (!modelPricing) return 0.04 * numImages // fallback
  const qualityPricing = modelPricing[quality] || modelPricing['standard']
  if (!qualityPricing) return 0.04 * numImages
  const perImage = qualityPricing[size] || Object.values(qualityPricing)[0] || 0.04
  return perImage * numImages
}

async function recordTransaction(
  selectedKey: SelectedKey,
  requestBody: Record<string, unknown> | null,
  responseBody: Record<string, unknown> | null,
  path: string
) {
  const model = (requestBody?.model as string) || 'unknown'
  let openaiCostUsd: number | undefined
  let inputTokens: number | undefined
  let outputTokens: number | undefined

  if (path.includes('/images/')) {
    // Image generation — charge per image
    const quality = (requestBody?.quality as string) || 'standard'
    const size = (requestBody?.size as string) || '1024x1024'
    const numImages = (responseBody?.data as unknown[])?.length || (requestBody?.n as number) || 1
    openaiCostUsd = getImageCost(model, quality, size, numImages)
  } else {
    // Token-based endpoints
    const usage = responseBody?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    inputTokens = usage?.prompt_tokens
    outputTokens = usage?.completion_tokens

    if (inputTokens !== undefined) {
      const pricing = await getModelPricing(model)
      if (pricing) {
        openaiCostUsd =
          (inputTokens || 0) * pricing.inputPricePerToken +
          (outputTokens || 0) * pricing.outputPricePerToken
      }
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
    inputTokens,
    outputTokens,
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

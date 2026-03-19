import { config } from '../config'
import { getModelPricing } from './fetcher'
import { estimateInputTokensFromMessages, estimateEmbeddingTokens } from '../utils/tokens'
import { PricingUnavailableError } from '../utils/errors'

const DEFAULT_MAX_OUTPUT_TOKENS = 4096

interface PriceEstimate {
  estimatedCostUsd: number
  buyerPriceUsd: number
  model: string
  inputTokens: number
  maxOutputTokens: number
}

/**
 * Calculate the buyer's price for a request, given a specific seller's markup.
 *
 * buyer_price = openai_base_cost × (1 + seller_markup/100) × (1 + platform_fee/100)
 */
export async function calculatePrice(
  endpoint: string,
  body: Record<string, unknown>,
  sellerMarkupPct: number
): Promise<PriceEstimate> {
  const model = (body.model as string) || 'gpt-4o'
  const pricing = await getModelPricing(model)

  if (!pricing) {
    throw new PricingUnavailableError(model)
  }

  let inputTokens = 0
  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS

  if (endpoint.includes('/chat/completions')) {
    const messages = body.messages as Array<{ role: string; content: string | null | Array<unknown> }>
    if (messages) {
      inputTokens = estimateInputTokensFromMessages(messages)
    }
    maxOutputTokens = (body.max_tokens as number) || (body.max_completion_tokens as number) || DEFAULT_MAX_OUTPUT_TOKENS
  } else if (endpoint.includes('/embeddings')) {
    const input = body.input as string | string[]
    if (input) {
      inputTokens = estimateEmbeddingTokens(input)
    }
    maxOutputTokens = 0 // Embeddings don't have output tokens billed the same way
  } else if (endpoint.includes('/images')) {
    // Image generation — use per-image pricing
    const n = (body.n as number) || 1
    const perImage = pricing.perImagePrice || 0.04 // Fallback
    const estimatedCost = perImage * n
    const buyerPrice = estimatedCost * (1 + sellerMarkupPct / 100) * (1 + config.platformFeePct / 100)
    return {
      estimatedCostUsd: estimatedCost,
      buyerPriceUsd: buyerPrice,
      model,
      inputTokens: 0,
      maxOutputTokens: 0,
    }
  } else if (endpoint.includes('/audio')) {
    // Audio — rough estimate based on typical pricing
    // For TTS/transcription, charge a flat rate per request for now
    const estimatedCost = 0.006
    const buyerPrice = estimatedCost * (1 + sellerMarkupPct / 100) * (1 + config.platformFeePct / 100)
    return {
      estimatedCostUsd: estimatedCost,
      buyerPriceUsd: buyerPrice,
      model,
      inputTokens: 0,
      maxOutputTokens: 0,
    }
  }

  // Token-based pricing
  const inputCost = inputTokens * pricing.inputPricePerToken
  const outputCost = maxOutputTokens * pricing.outputPricePerToken
  const estimatedCost = inputCost + outputCost

  const buyerPrice = estimatedCost * (1 + sellerMarkupPct / 100) * (1 + config.platformFeePct / 100)

  return {
    estimatedCostUsd: estimatedCost,
    buyerPriceUsd: buyerPrice,
    model,
    inputTokens,
    maxOutputTokens,
  }
}

/**
 * Break down the buyer's payment into seller earnings and platform fee.
 */
export function splitPayment(buyerPaidUsd: number, sellerMarkupPct: number) {
  const platformFeeUsd = buyerPaidUsd * (config.platformFeePct / (100 + config.platformFeePct))
  const sellerEarnedUsd = buyerPaidUsd - platformFeeUsd
  return { sellerEarnedUsd, platformFeeUsd }
}

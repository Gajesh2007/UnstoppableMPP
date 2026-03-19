import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb } from '../db/client'
import { modelPricing } from '../db/schema'
import { config } from '../config'

// OpenAI pricing page doesn't have a JSON API, but openrouter does.
// We fetch from OpenAI's models endpoint to get the list, then
// use a known pricing source for costs.
// For now: fetch from openrouter which exposes pricing in its /api/v1/models response.

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

interface OpenRouterModel {
  id: string
  pricing: {
    prompt: string   // price per token as string
    completion: string
    image: string
  }
}

/**
 * Fetch OpenAI model pricing from OpenRouter (which aggregates pricing data).
 * Filters to only openai/* models and normalizes into our schema.
 */
export async function fetchAndCachePricing(): Promise<number> {
  const response = await fetch(OPENROUTER_MODELS_URL)
  if (!response.ok) {
    console.error(`Failed to fetch pricing: ${response.status} ${response.statusText}`)
    return 0
  }

  const data = (await response.json()) as { data: OpenRouterModel[] }
  const openaiModels = data.data.filter((m) => m.id.startsWith('openai/'))

  const db = getDb()
  const now = new Date()
  let count = 0

  for (const model of openaiModels) {
    // Normalize model ID: "openai/gpt-4o" → "gpt-4o"
    const modelId = model.id.replace('openai/', '')
    const inputPrice = parseFloat(model.pricing.prompt) || 0
    const outputPrice = parseFloat(model.pricing.completion) || 0
    const imagePrice = parseFloat(model.pricing.image) || undefined

    // Upsert: delete old + insert new
    await db.delete(modelPricing).where(eq(modelPricing.modelId, modelId))
    await db.insert(modelPricing).values({
      id: nanoid(),
      modelId,
      inputPricePerToken: inputPrice,
      outputPricePerToken: outputPrice,
      perImagePrice: imagePrice,
      fetchedAt: now,
    })
    count++
  }

  console.log(`[pricing] Cached pricing for ${count} OpenAI models`)
  return count
}

/** Get pricing for a specific model. Returns null if not found. */
export async function getModelPricing(modelId: string) {
  const db = getDb()
  return db.query.modelPricing.findFirst({
    where: eq(modelPricing.modelId, modelId),
  })
}

/** Get all cached model pricing */
export async function getAllPricing() {
  const db = getDb()
  return db.query.modelPricing.findMany()
}

let refreshInterval: ReturnType<typeof setInterval> | null = null

/** Start periodic pricing refresh */
export function startPricingRefresh() {
  // Fetch immediately on startup
  fetchAndCachePricing().catch((err) =>
    console.error('[pricing] Initial fetch failed:', err)
  )

  // Then refresh on interval
  refreshInterval = setInterval(
    () => {
      fetchAndCachePricing().catch((err) =>
        console.error('[pricing] Refresh failed:', err)
      )
    },
    config.pricingRefreshIntervalMin * 60 * 1000
  )
}

export function stopPricingRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

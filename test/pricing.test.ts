import { describe, test, expect, beforeAll } from 'bun:test'
process.env.DATABASE_PATH = './data/test-pricing.db'
import { getDb } from '../src/db/client'
import { initPlatform } from '../src/crypto/platform'
import { fetchAndCachePricing, getModelPricing, getAllPricing } from '../src/pricing/fetcher'
import { calculatePrice, splitPayment } from '../src/pricing/calculator'

beforeAll(async () => {
  initPlatform()
  getDb()
  await fetchAndCachePricing()
})

describe('Pricing Fetcher', () => {
  test('fetches pricing for OpenAI models', async () => {
    const all = await getAllPricing()
    expect(all.length).toBeGreaterThan(0)
  })

  test('has pricing for gpt-4o', async () => {
    const pricing = await getModelPricing('gpt-4o')
    expect(pricing).toBeTruthy()
    expect(pricing!.inputPricePerToken).toBeGreaterThan(0)
    expect(pricing!.outputPricePerToken).toBeGreaterThan(0)
  })

  test('has pricing for gpt-4o-mini', async () => {
    const pricing = await getModelPricing('gpt-4o-mini')
    expect(pricing).toBeTruthy()
    expect(pricing!.inputPricePerToken).toBeGreaterThan(0)
  })

  test('gpt-4o-mini is cheaper than gpt-4o', async () => {
    const mini = await getModelPricing('gpt-4o-mini')
    const full = await getModelPricing('gpt-4o')
    expect(mini!.inputPricePerToken).toBeLessThan(full!.inputPricePerToken)
  })

  test('returns null for unknown model', async () => {
    const pricing = await getModelPricing('nonexistent-model-xyz')
    expect(pricing).toBeUndefined()
  })
})

describe('Price Calculator', () => {
  test('calculates chat completion price', async () => {
    const estimate = await calculatePrice(
      '/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      },
      0 // no markup
    )
    expect(estimate.buyerPriceUsd).toBeGreaterThan(0)
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0)
    expect(estimate.buyerPriceUsd).toBeGreaterThan(estimate.estimatedCostUsd) // platform fee
    expect(estimate.model).toBe('gpt-4o-mini')
    expect(estimate.inputTokens).toBeGreaterThan(0)
  })

  test('negative markup (discount) lowers buyer price', async () => {
    const noMarkup = await calculatePrice(
      '/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 },
      0
    )
    const discount = await calculatePrice(
      '/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 },
      -20
    )
    expect(discount.buyerPriceUsd).toBeLessThan(noMarkup.buyerPriceUsd)
  })

  test('positive markup increases buyer price', async () => {
    const noMarkup = await calculatePrice(
      '/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 },
      0
    )
    const premium = await calculatePrice(
      '/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 },
      50
    )
    expect(premium.buyerPriceUsd).toBeGreaterThan(noMarkup.buyerPriceUsd)
  })

  test('embedding endpoint sets zero output tokens', async () => {
    // Use gpt-4o-mini as a stand-in since OpenRouter doesn't list embedding model pricing.
    // The calculator still correctly sets maxOutputTokens=0 for /v1/embeddings endpoints.
    const estimate = await calculatePrice(
      '/v1/embeddings',
      { model: 'gpt-4o-mini', input: 'test input text' },
      0
    )
    expect(estimate.maxOutputTokens).toBe(0)
    expect(estimate.buyerPriceUsd).toBeGreaterThan(0)
  })

  test('longer input = higher price', async () => {
    const short = await calculatePrice(
      '/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 },
      0
    )
    const long = await calculatePrice(
      '/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'a'.repeat(10000) }], max_tokens: 100 },
      0
    )
    expect(long.buyerPriceUsd).toBeGreaterThan(short.buyerPriceUsd)
  })

  test('throws for unknown model', async () => {
    expect(
      calculatePrice('/v1/chat/completions', { model: 'nonexistent-xyz', messages: [] }, 0)
    ).rejects.toThrow('Pricing not available')
  })
})

describe('splitPayment', () => {
  test('splits payment into seller earnings and platform fee', () => {
    const { sellerEarnedUsd, platformFeeUsd } = splitPayment(1.0, 0)
    expect(sellerEarnedUsd + platformFeeUsd).toBeCloseTo(1.0, 6)
    expect(platformFeeUsd).toBeGreaterThan(0)
    expect(sellerEarnedUsd).toBeGreaterThan(platformFeeUsd)
  })

  test('platform fee is ~5% of buyer payment', () => {
    const { platformFeeUsd } = splitPayment(100, 0)
    // 5 / 105 * 100 ≈ 4.76 (platform fee extracted from total)
    expect(platformFeeUsd).toBeCloseTo(4.76, 1)
  })
})

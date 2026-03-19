import { Hono } from 'hono'
import { getMppx } from '../mpp/setup'
import { selectCheapestKey } from './key-selector'
import { calculatePrice } from '../pricing/calculator'
import { proxyToOpenAI } from './handler'
import { proxyStreamingToOpenAI } from './streaming'

const proxy = new Hono()

// GET /v1/models — free, no payment required, proxy directly
proxy.get('/v1/models', async (c) => {
  let selectedKey
  try {
    selectedKey = await selectCheapestKey()
  } catch {
    return c.json({ error: { message: 'No API keys available', type: 'server_error' } }, 503)
  }

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${selectedKey.decryptedKey}` },
    })
    const data = await response.json()
    return c.json(data, response.status as 200)
  } catch {
    return c.json({ error: { message: 'Failed to fetch models from upstream', type: 'server_error' } }, 502)
  }
})

// ALL /v1/* — paid endpoints, MPP-gated wildcard proxy
proxy.all('/v1/*', async (c) => {
  const path = `/${c.req.path.split('/').slice(1).join('/')}`
  const method = c.req.method

  // Parse request body for POST/PUT/PATCH
  let body: Record<string, unknown> | null = null
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      body = await c.req.json()
    } catch {
      // Non-JSON body (e.g., file uploads for audio) — pass through
    }
  }

  // Get cheapest key for pricing
  let selectedKey
  try {
    selectedKey = await selectCheapestKey()
  } catch {
    return c.json({ error: { message: 'No API keys available', type: 'server_error' } }, 503)
  }

  // Calculate price based on request
  let buyerPriceUsd: number
  let priceDescription: string
  try {
    const estimate = await calculatePrice(path, body || {}, selectedKey.markupPct)
    buyerPriceUsd = estimate.buyerPriceUsd
    priceDescription = `${estimate.model}, est. ${estimate.inputTokens} input tokens`
  } catch {
    buyerPriceUsd = 0.001
    priceDescription = 'minimum rate'
  }

  // Floor price
  buyerPriceUsd = Math.max(buyerPriceUsd, 0.0001)

  // MPP 402 challenge/credential flow
  const mppx = getMppx()
  const amountStr = buyerPriceUsd.toFixed(6)

  const result = await mppx.charge({
    amount: amountStr,
    description: `OpenAI API: ${method} ${path} (${priceDescription})`,
  })(c.req.raw)

  if (result.status === 402) {
    // Return the 402 challenge directly — bypass Hono's header merging
    // to avoid Bun's strict WWW-Authenticate validation during Response cloning
    return result.challenge as Response
  }

  // Payment verified — proxy the request
  if (body?.stream === true) {
    const response = await proxyStreamingToOpenAI(path, c.req.raw.headers, body, buyerPriceUsd)
    return result.withReceipt(response) as Response
  }

  const response = await proxyToOpenAI(method, path, c.req.raw.headers, body, buyerPriceUsd)
  return result.withReceipt(response) as Response
})

export { proxy }

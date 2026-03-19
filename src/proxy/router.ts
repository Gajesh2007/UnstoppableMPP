import { Hono } from 'hono'
import { getMppx } from '../mpp/setup'
import { selectCheapestKey } from './key-selector'
import { getModelPricing } from '../pricing/fetcher'
import { proxyToOpenAI } from './handler'
import { proxyStreamingToOpenAI } from './streaming'
import { config } from '../config'

const proxy = new Hono()

// GET /v1/models — free, no payment required
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

// ALL /v1/* — paid endpoints, MPP session-gated
proxy.all('/v1/*', async (c) => {
  const path = `/${c.req.path.split('/').slice(1).join('/')}`
  const method = c.req.method

  let body: Record<string, unknown> | null = null
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      body = await c.req.json()
    } catch {
      // Non-JSON body — pass through
    }
  }

  // Get cheapest key for pricing context
  let selectedKey
  try {
    selectedKey = await selectCheapestKey()
  } catch {
    return c.json({ error: { message: 'No API keys available', type: 'server_error' } }, 503)
  }

  // Calculate per-token cost for this model + seller markup
  const model = (body?.model as string) || 'gpt-5.4'
  const pricing = await getModelPricing(model)
  const markupMultiplier = 1 + (selectedKey.markupPct / 100)
  const feeMultiplier = 1 + (config.platformFeePct / 100)

  // Per-token cost in USD (6 decimals). Fallback to a reasonable default.
  const inputCostPerToken = (pricing?.inputPricePerToken || 0.0000025) * markupMultiplier * feeMultiplier
  const outputCostPerToken = (pricing?.outputPricePerToken || 0.00001) * markupMultiplier * feeMultiplier

  const isStreaming = body?.stream === true
  const mppx = getMppx()

  if (isStreaming) {
    // Streaming: use session with SSE — charge per output token as chunks arrive
    const tickCost = outputCostPerToken.toFixed(6)

    const result = await mppx.session({
      amount: tickCost,
      unitType: 'token',
      description: `OpenAI streaming: ${model}`,
      suggestedDeposit: '1',
    })(c.req.raw)

    if (result.status === 402) {
      return result.challenge as Response
    }

    const response = await proxyStreamingToOpenAI(path, c.req.raw.headers, body!, selectedKey)
    return result.withReceipt(response) as Response
  } else {
    // Non-streaming: use session — charge once based on estimated input + max output tokens
    const inputTokens = estimateInputTokens(body)
    const maxOutputTokens = (body?.max_tokens as number) || (body?.max_completion_tokens as number) || 4096
    const estimatedCost = (inputTokens * inputCostPerToken) + (maxOutputTokens * outputCostPerToken)
    const amount = Math.max(estimatedCost, 0.0001).toFixed(6)

    const result = await mppx.session({
      amount,
      unitType: 'request',
      description: `OpenAI API: ${method} ${path} (${model})`,
      suggestedDeposit: '1',
    })(c.req.raw)

    if (result.status === 402) {
      return result.challenge as Response
    }

    const response = await proxyToOpenAI(method, path, c.req.raw.headers, body, selectedKey)
    return result.withReceipt(response) as Response
  }
})

function estimateInputTokens(body: Record<string, unknown> | null): number {
  if (!body) return 0
  const messages = body.messages as Array<{ content: string | null | unknown[] }> | undefined
  if (!messages) {
    const input = body.input
    if (typeof input === 'string') return Math.ceil(input.length / 4)
    if (Array.isArray(input)) return input.reduce((sum: number, s) => sum + Math.ceil(String(s).length / 4), 0)
    return 0
  }
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') chars += msg.content.length
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part && 'text' in part) chars += String((part as { text: string }).text).length
      }
    }
    chars += 16 // role + overhead
  }
  return Math.ceil(chars / 4)
}

export { proxy }

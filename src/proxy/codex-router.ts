import { Hono } from 'hono'
import { getMppx } from '../mpp/setup'
import { selectCheapestCodexToken } from './codex-token-selector'
import { getModelPricing } from '../pricing/fetcher'
import { proxyCodexToChatGPT } from './codex-handler'
import { config } from '../config'

const codex = new Hono()

/**
 * POST /codex/responses — Codex Responses API proxy.
 *
 * Proxies to chatgpt.com/backend-api/codex/responses using seller's
 * ChatGPT session tokens. Buyers pay via MPP sessions per-token.
 * ChatGPT Codex always streams.
 */
codex.post('/responses', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400)
  }

  let selectedToken
  try {
    selectedToken = await selectCheapestCodexToken()
  } catch {
    return c.json({ error: { message: 'No Codex tokens available', type: 'server_error' } }, 503)
  }

  const model = (body.model as string) || 'gpt-5.3-codex'
  const pricing = await getModelPricing(model)
  const markupMultiplier = 1 + (selectedToken.markupPct / 100)
  const feeMultiplier = 1 + (config.platformFeePct / 100)

  // Per-token cost — use output price since that's what flows through the SSE stream.
  // Input + cached input cost is calculated post-response from the usage breakdown
  // and recorded in the transaction.
  const outputCostPerToken = (pricing?.outputPricePerToken || 0.000014) * markupMultiplier * feeMultiplier
  const tickCost = outputCostPerToken.toFixed(6)
  const mppx = getMppx()

  const result = await mppx.session({
    amount: tickCost,
    unitType: 'token',
    description: `Codex (ChatGPT): ${model}`,
    suggestedDeposit: '1',
  })(c.req.raw)

  if (result.status === 402) {
    return result.challenge as Response
  }

  const response = await proxyCodexToChatGPT(c.req.raw.headers, body, selectedToken)
  return result.withReceipt(response) as Response
})

/**
 * GET /codex/ — Health/info endpoint for Codex integration.
 */
codex.get('/', (c) =>
  c.json({
    name: 'UnstoppableMPP — Codex Endpoint',
    status: 'running',
    api: 'ChatGPT Codex Responses API',
    usage: 'POST /codex/responses',
    auth: 'ChatGPT session tokens (sellers authenticate via device code flow)',
    disclaimer: 'This is experimental research software provided "as is" without warranty. Users are solely responsible for compliance with all applicable laws and third-party terms of service. Use at your own risk.',
  })
)

export { codex }

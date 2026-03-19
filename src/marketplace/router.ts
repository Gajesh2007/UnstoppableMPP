import { Hono } from 'hono'
import { sellerAuth, type AuthEnv } from './auth'
import { getPlatformPublicKey } from '../crypto/platform'
import {
  registerSeller,
  addApiKey,
  listKeys,
  updateKey,
  deactivateKey,
  getSellerBalance,
} from './seller.service'
import { executePayout, getPayoutHistory } from '../mpp/payout'

const marketplace = new Hono<AuthEnv>()

// Public: get the platform's public key (sellers encrypt their API keys to this)
marketplace.get('/public-key', (c) => {
  return c.json({ public_key: getPlatformPublicKey() })
})

// Public: register as a seller
marketplace.post('/sellers', async (c) => {
  const body = await c.req.json<{ wallet_address: string }>()

  if (!body.wallet_address) {
    return c.json({ error: 'wallet_address is required' }, 400)
  }

  const result = await registerSeller(body.wallet_address)

  return c.json(
    {
      id: result.id,
      auth_token: result.authToken,
      public_key: getPlatformPublicKey(),
      message: 'Store this auth_token securely. It will not be shown again. Use the public_key to ECIES-encrypt your API keys before submitting them.',
    },
    201
  )
})

// All routes below require seller auth
marketplace.use('/keys', sellerAuth)
marketplace.use('/keys/*', sellerAuth)
marketplace.use('/balance', sellerAuth)
marketplace.use('/payout', sellerAuth)
marketplace.use('/payouts', sellerAuth)

// Add an API key (must be ECIES-encrypted to the platform's public key)
marketplace.post('/keys', async (c) => {
  const sellerId = c.get('sellerId')
  const body = await c.req.json<{
    encrypted_key: string
    spending_limit_usd?: number | null
    markup_pct?: number
  }>()

  if (!body.encrypted_key) {
    return c.json({ error: 'encrypted_key is required (ECIES-encrypted hex of your OpenAI API key)' }, 400)
  }

  try {
    const result = await addApiKey(
      sellerId,
      body.encrypted_key,
      body.spending_limit_usd ?? null,
      body.markup_pct ?? 0
    )
    return c.json({ id: result.id, message: 'API key registered' }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add key'
    return c.json({ error: message }, 400)
  }
})

// List your keys
marketplace.get('/keys', async (c) => {
  const sellerId = c.get('sellerId')
  const keys = await listKeys(sellerId)
  return c.json({ keys })
})

// Update a key's pricing/limits
marketplace.patch('/keys/:id', async (c) => {
  const sellerId = c.get('sellerId')
  const keyId = c.req.param('id')
  const body = await c.req.json<{
    spending_limit_usd?: number | null
    markup_pct?: number
  }>()

  const updates: Record<string, unknown> = {}
  if (body.spending_limit_usd !== undefined) updates.spendingLimitUsd = body.spending_limit_usd
  if (body.markup_pct !== undefined) updates.markupPct = body.markup_pct

  const result = await updateKey(sellerId, keyId, updates)
  return c.json(result)
})

// Deactivate a key
marketplace.delete('/keys/:id', async (c) => {
  const sellerId = c.get('sellerId')
  const keyId = c.req.param('id')
  await deactivateKey(sellerId, keyId)
  return c.json({ message: 'Key deactivated' })
})

// Check balance
marketplace.get('/balance', async (c) => {
  const sellerId = c.get('sellerId')
  const balance = await getSellerBalance(sellerId)
  return c.json(balance)
})

// Execute instant payout via Tempo TIP-20 transfer
marketplace.post('/payout', async (c) => {
  const sellerId = c.get('sellerId')

  try {
    const result = await executePayout(sellerId)
    return c.json({
      status: 'completed',
      amount_usd: result.amount,
      tx_hash: result.txHash,
      payout_id: result.payoutId,
      explorer: `https://explore.tempo.xyz/tx/${result.txHash}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payout failed'
    return c.json({ error: message }, 400)
  }
})

// Get payout history
marketplace.get('/payouts', async (c) => {
  const sellerId = c.get('sellerId')
  const history = await getPayoutHistory(sellerId)
  return c.json({ payouts: history })
})

export { marketplace }

import { Hono } from 'hono'
import { walletAuth, generateNonce, verifySignedNonce, createSession, type AuthEnv } from './auth'
import { getPlatformPublicKey } from '../crypto/platform'
import {
  addApiKey,
  listKeys,
  updateKey,
  delistKey,
  getSellerBalance,
  getSellerId,
} from './seller.service'
import { executePayout, getPayoutHistory } from '../mpp/payout'

const marketplace = new Hono<AuthEnv>()

// --- Public routes ---

// Platform public key (sellers encrypt API keys to this)
marketplace.get('/public-key', (c) => {
  return c.json({ public_key: getPlatformPublicKey() })
})

// Get a nonce to sign for authentication
marketplace.post('/auth/nonce', async (c) => {
  const { address } = await c.req.json<{ address: string }>()
  if (!address) return c.json({ error: 'address is required' }, 400)

  const nonce = generateNonce(address)
  const message = `Sign in to UnstoppableMPP\n\nNonce: ${nonce}`
  return c.json({ nonce, message })
})

// Verify signature and issue session token
marketplace.post('/auth/verify', async (c) => {
  const { address, signature, nonce } = await c.req.json<{
    address: string
    signature: string
    nonce: string
  }>()

  if (!address || !signature || !nonce) {
    return c.json({ error: 'address, signature, and nonce are required' }, 400)
  }

  const valid = await verifySignedNonce(address, signature, nonce)
  if (!valid) {
    return c.json({ error: 'Invalid signature or expired nonce' }, 401)
  }

  const token = createSession(address)
  return c.json({ token, address: address.toLowerCase() })
})

// --- Authenticated routes ---

marketplace.use('/keys', walletAuth)
marketplace.use('/keys/*', walletAuth)
marketplace.use('/balance', walletAuth)
marketplace.use('/payout', walletAuth)
marketplace.use('/payouts', walletAuth)

// Add an API key (ECIES-encrypted to platform public key)
marketplace.post('/keys', async (c) => {
  const walletAddress = c.get('walletAddress')
  const body = await c.req.json<{
    encrypted_key: string
    spending_limit_usd?: number | null
    markup_pct?: number
  }>()

  if (!body.encrypted_key) {
    return c.json({ error: 'encrypted_key is required' }, 400)
  }

  try {
    const result = await addApiKey(
      walletAddress,
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
  const walletAddress = c.get('walletAddress')
  const keys = await listKeys(walletAddress)
  return c.json({ keys })
})

// Update a key's pricing/limits
marketplace.patch('/keys/:id', async (c) => {
  const walletAddress = c.get('walletAddress')
  const keyId = c.req.param('id')
  const body = await c.req.json<{
    spending_limit_usd?: number | null
    markup_pct?: number
  }>()

  const updates: Record<string, unknown> = {}
  if (body.spending_limit_usd !== undefined) updates.spendingLimitUsd = body.spending_limit_usd
  if (body.markup_pct !== undefined) updates.markupPct = body.markup_pct

  try {
    const result = await updateKey(walletAddress, keyId, updates)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Key not found'
    return c.json({ error: message }, 404)
  }
})

// Delist a key
marketplace.delete('/keys/:id', async (c) => {
  const walletAddress = c.get('walletAddress')
  const keyId = c.req.param('id')
  try {
    await delistKey(walletAddress, keyId)
    return c.json({ message: 'Key delisted' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Key not found'
    return c.json({ error: message }, 404)
  }
})

// Check balance
marketplace.get('/balance', async (c) => {
  const walletAddress = c.get('walletAddress')
  const balance = await getSellerBalance(walletAddress)
  return c.json(balance)
})

// Instant payout via Tempo
marketplace.post('/payout', async (c) => {
  const walletAddress = c.get('walletAddress')
  const sellerId = await getSellerId(walletAddress)

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

// Payout history
marketplace.get('/payouts', async (c) => {
  const walletAddress = c.get('walletAddress')
  const sellerId = await getSellerId(walletAddress)
  const history = await getPayoutHistory(sellerId)
  return c.json({ payouts: history })
})

export { marketplace }

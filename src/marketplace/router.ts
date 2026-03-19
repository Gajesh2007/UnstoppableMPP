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
import {
  requestDeviceCode,
  pollDeviceCode,
  exchangeCodeForTokens,
  storeCodexTokens,
  listCodexTokens,
  delistCodexToken,
} from './codex-oauth'

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
marketplace.use('/codex/import', walletAuth)
marketplace.use('/codex/poll', walletAuth)
marketplace.use('/codex/tokens', walletAuth)
marketplace.use('/codex/tokens/*', walletAuth)

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

// --- Codex ChatGPT token routes ---

// Direct import: seller runs `codex login`, then `cat ~/.codex/auth.json`, and pastes tokens here
marketplace.post('/codex/import', async (c) => {
  const walletAddress = c.get('walletAddress')
  const body = await c.req.json<{
    access_token: string
    refresh_token: string
    id_token: string
    markup_pct?: number
  }>()

  if (!body.access_token || !body.refresh_token || !body.id_token) {
    return c.json({
      error: 'access_token, refresh_token, and id_token are required. Run `codex login` then `cat ~/.codex/auth.json` to get them.',
    }, 400)
  }

  try {
    const stored = await storeCodexTokens(
      walletAddress,
      {
        idToken: body.id_token,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
      },
      body.markup_pct ?? 0
    )

    return c.json({
      token_id: stored.id,
      email: stored.email,
      plan_type: stored.planType,
      account_id: stored.accountId,
      message: 'ChatGPT tokens imported. Your Codex credits are now available on the marketplace.',
      disclaimer: 'By listing credentials you represent that you have the right to share them and accept full responsibility for any consequences. This platform does not encourage violation of any third-party terms of service.',
    }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to import tokens'
    return c.json({ error: message }, 400)
  }
})

// Device code flow — Step 1: Start (public — no auth needed to initiate)
marketplace.post('/codex/login', async (c) => {
  try {
    const result = await requestDeviceCode()
    return c.json({
      user_code: result.userCode,
      verification_url: result.verificationUrl,
      device_auth_id: result.deviceAuthId,
      interval: result.interval,
      instructions: `1. Open ${result.verificationUrl}\n2. Enter code: ${result.userCode}\n3. Sign in with your ChatGPT account\n4. Call POST /marketplace/codex/poll with device_auth_id and user_code`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start login'
    return c.json({ error: message }, 502)
  }
})

// Step 2: Poll for completion + exchange tokens (requires wallet auth)
marketplace.post('/codex/poll', async (c) => {
  const walletAddress = c.get('walletAddress')
  const { device_auth_id, user_code, markup_pct } = await c.req.json<{
    device_auth_id: string
    user_code: string
    markup_pct?: number
  }>()

  if (!device_auth_id || !user_code) {
    return c.json({ error: 'device_auth_id and user_code are required' }, 400)
  }

  try {
    const pollResult = await pollDeviceCode(device_auth_id, user_code)

    if (!pollResult) {
      return c.json({ status: 'pending', message: 'Waiting for user to authenticate...' })
    }

    // User authenticated — exchange for tokens
    const tokens = await exchangeCodeForTokens(
      pollResult.authorization_code,
      pollResult.code_verifier
    )

    // Store encrypted tokens
    const stored = await storeCodexTokens(walletAddress, tokens, markup_pct ?? 0)

    return c.json({
      status: 'complete',
      token_id: stored.id,
      email: stored.email,
      plan_type: stored.planType,
      account_id: stored.accountId,
      message: 'ChatGPT tokens stored. Your Codex credits are now available on the marketplace.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Poll failed'
    return c.json({ error: message }, 502)
  }
})

// List your Codex tokens
marketplace.get('/codex/tokens', async (c) => {
  const walletAddress = c.get('walletAddress')
  const tokens = await listCodexTokens(walletAddress)
  return c.json({ tokens })
})

// Revoke a Codex token
marketplace.delete('/codex/tokens/:id', async (c) => {
  const walletAddress = c.get('walletAddress')
  const tokenId = c.req.param('id')
  try {
    await delistCodexToken(walletAddress, tokenId)
    return c.json({ message: 'Codex token delisted' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token not found'
    return c.json({ error: message }, 404)
  }
})

export { marketplace }

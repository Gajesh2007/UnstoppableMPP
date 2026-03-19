/**
 * ChatGPT OAuth device code flow for Codex token acquisition.
 *
 * Sellers authenticate with their ChatGPT Plus/Pro account through the
 * device code flow. We store the resulting tokens (encrypted) and use
 * them to proxy Codex requests to chatgpt.com/backend-api/codex/responses.
 */
import { nanoid } from 'nanoid'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../db/client'
import { sellers, codexTokens } from '../db/schema'
import { getOrCreateSeller } from './seller.service'
import { encryptForPlatform, decryptApiKey } from '../crypto/platform'

const AUTH_ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

// --- Device Code Flow ---

interface DeviceCodeResponse {
  device_auth_id: string
  user_code: string
  interval: number
}

/**
 * Step 1: Request a device code from OpenAI.
 * Returns { user_code, verification_url, device_auth_id, interval }
 */
export async function requestDeviceCode(): Promise<{
  userCode: string
  verificationUrl: string
  deviceAuthId: string
  interval: number
}> {
  const resp = await fetch(`${AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Device code request failed (${resp.status}): ${text}`)
  }

  const data = (await resp.json()) as DeviceCodeResponse
  return {
    userCode: data.user_code,
    verificationUrl: `${AUTH_ISSUER}/codex/device`,
    deviceAuthId: data.device_auth_id,
    interval: typeof data.interval === 'string' ? parseInt(data.interval, 10) : (data.interval || 5),
  }
}

interface TokenPollSuccess {
  authorization_code: string
  code_challenge: string
  code_verifier: string
}

/**
 * Step 2: Poll for the user to complete authentication.
 * Returns the authorization code + PKCE verifier once the user authenticates.
 * Returns null if still pending.
 */
export async function pollDeviceCode(
  deviceAuthId: string,
  userCode: string
): Promise<TokenPollSuccess | null> {
  const resp = await fetch(`${AUTH_ISSUER}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }),
  })

  if (resp.ok) {
    return (await resp.json()) as TokenPollSuccess
  }

  // 403/404 = still pending
  if (resp.status === 403 || resp.status === 404) {
    return null
  }

  const text = await resp.text()
  throw new Error(`Device code poll failed (${resp.status}): ${text}`)
}

interface ExchangedTokens {
  idToken: string
  accessToken: string
  refreshToken: string
}

/**
 * Step 3: Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  authorizationCode: string,
  codeVerifier: string
): Promise<ExchangedTokens> {
  const redirectUri = `${AUTH_ISSUER}/deviceauth/callback`

  const resp = await fetch(`${AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Token exchange failed (${resp.status}): ${text}`)
  }

  const data = (await resp.json()) as {
    id_token: string
    access_token: string
    refresh_token: string
  }

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  }
}

// --- ID Token Parsing ---

interface IdTokenClaims {
  email?: string
  'https://api.openai.com/auth'?: {
    chatgpt_plan_type?: string
    chatgpt_account_id?: string
    chatgpt_user_id?: string
  }
}

function parseIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split('.')
  if (parts.length < 2) return {}
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
  return JSON.parse(payload) as IdTokenClaims
}

// --- Token Storage ---

/**
 * Store ChatGPT tokens for a seller.
 * Encrypts access_token and refresh_token with the platform's ECIES key.
 */
export async function storeCodexTokens(
  walletAddress: string,
  tokens: ExchangedTokens,
  markupPct: number = 0
): Promise<{ id: string; email?: string; planType?: string; accountId: string }> {
  const seller = await getOrCreateSeller(walletAddress)
  const claims = parseIdToken(tokens.idToken)
  const auth = claims['https://api.openai.com/auth']
  const accountId = auth?.chatgpt_account_id

  if (!accountId) {
    throw new Error('Could not extract account_id from ChatGPT id_token')
  }

  const encryptedAccess = encryptForPlatform(tokens.accessToken)
  const encryptedRefresh = encryptForPlatform(tokens.refreshToken)

  const db = getDb()
  const id = nanoid()

  await db.insert(codexTokens).values({
    id,
    sellerId: seller.id,
    encryptedAccessToken: encryptedAccess,
    encryptedRefreshToken: encryptedRefresh,
    accountId,
    planType: auth?.chatgpt_plan_type || null,
    email: claims.email || null,
    markupPct,
    isActive: true,
    isHealthy: true,
    failureCount: 0,
    lastRefreshedAt: new Date(),
    createdAt: new Date(),
  })

  return {
    id,
    email: claims.email,
    planType: auth?.chatgpt_plan_type,
    accountId,
  }
}

// --- Token Refresh ---

/**
 * Refresh a ChatGPT access token using the stored refresh token.
 * Updates the encrypted tokens in the database.
 */
export async function refreshCodexToken(tokenId: string): Promise<boolean> {
  const db = getDb()
  const token = await db.query.codexTokens.findFirst({
    where: eq(codexTokens.id, tokenId),
  })

  if (!token) return false

  const refreshToken = decryptApiKey(token.encryptedRefreshToken)

  const resp = await fetch(`${AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!resp.ok) {
    console.error(`[codex-oauth] Token refresh failed for ${tokenId}: ${resp.status}`)
    return false
  }

  const data = (await resp.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
  }

  const updates: Record<string, unknown> = {
    lastRefreshedAt: new Date(),
  }

  if (data.access_token) {
    updates.encryptedAccessToken = encryptForPlatform(data.access_token)
  }
  if (data.refresh_token) {
    updates.encryptedRefreshToken = encryptForPlatform(data.refresh_token)
  }

  await db.update(codexTokens).set(updates).where(eq(codexTokens.id, tokenId))
  console.log(`[codex-oauth] Refreshed token ${tokenId}`)
  return true
}

// --- Listing / Management ---

export async function listCodexTokens(walletAddress: string) {
  const seller = await getOrCreateSeller(walletAddress)
  const db = getDb()
  return db.query.codexTokens.findMany({
    where: eq(codexTokens.sellerId, seller.id),
    columns: {
      id: true,
      accountId: true,
      planType: true,
      email: true,
      markupPct: true,
      isActive: true,
      isHealthy: true,
      failureCount: true,
      lastRefreshedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })
}

export async function delistCodexToken(walletAddress: string, tokenId: string) {
  const seller = await getOrCreateSeller(walletAddress)
  const db = getDb()
  const token = await db.query.codexTokens.findFirst({
    where: and(eq(codexTokens.id, tokenId), eq(codexTokens.sellerId, seller.id)),
  })
  if (!token) throw new Error('Token not found')
  await db.update(codexTokens).set({ isActive: false }).where(eq(codexTokens.id, tokenId))
}

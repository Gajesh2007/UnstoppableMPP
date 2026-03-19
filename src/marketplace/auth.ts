import { createMiddleware } from 'hono/factory'
import { verifyMessage } from 'viem'
import { nanoid } from 'nanoid'

export type AuthEnv = {
  Variables: {
    walletAddress: string
  }
}

// Nonce store: address → { nonce, expiresAt }
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>()

const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Clean up expired nonces periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of nonceStore) {
    if (entry.expiresAt < now) nonceStore.delete(key)
  }
}, 60_000)

/**
 * Generate a nonce for a wallet address to sign.
 */
export function generateNonce(address: string): string {
  const nonce = nanoid(32)
  nonceStore.set(address.toLowerCase(), {
    nonce,
    expiresAt: Date.now() + NONCE_TTL_MS,
  })
  return nonce
}

/**
 * Verify a signed nonce and consume it (single-use).
 */
export async function verifySignedNonce(
  address: string,
  signature: string,
  nonce: string
): Promise<boolean> {
  const key = address.toLowerCase()
  const stored = nonceStore.get(key)

  if (!stored || stored.nonce !== nonce || stored.expiresAt < Date.now()) {
    return false
  }

  const message = `Sign in to UnstoppableMPP\n\nNonce: ${nonce}`

  try {
    const valid = await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` })
    if (valid) {
      nonceStore.delete(key) // Consume nonce
    }
    return valid
  } catch {
    return false
  }
}

/**
 * Session store: token → wallet address.
 * After verifying a signature, we issue a session token so the
 * client doesn't need to sign every request.
 */
const sessionStore = new Map<string, { address: string; expiresAt: number }>()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of sessionStore) {
    if (entry.expiresAt < now) sessionStore.delete(key)
  }
}, 5 * 60_000)

export function createSession(address: string): string {
  const token = nanoid(48)
  sessionStore.set(token, {
    address: address.toLowerCase(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  return token
}

/**
 * Middleware: authenticate via session token in Authorization header.
 * The wallet address is set on the context as `walletAddress`.
 */
export const walletAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const session = sessionStore.get(token)

  if (!session || session.expiresAt < Date.now()) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }

  c.set('walletAddress', session.address)
  await next()
})

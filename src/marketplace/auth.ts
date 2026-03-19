import { createMiddleware } from 'hono/factory'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { sellers } from '../db/schema'

export type AuthEnv = {
  Variables: {
    sellerId: string
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const sellerAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const tokenHash = hashToken(token)

  const db = getDb()
  const seller = await db.query.sellers.findFirst({
    where: eq(sellers.authTokenHash, tokenHash),
  })

  if (!seller) {
    return c.json({ error: 'Invalid auth token' }, 401)
  }

  c.set('sellerId', seller.id)
  await next()
})

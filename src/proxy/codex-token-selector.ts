import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { codexTokens } from '../db/schema'
import { decryptApiKey } from '../crypto/platform'
import { refreshCodexToken } from '../marketplace/codex-oauth'
import { NoHealthyKeysError } from '../utils/errors'

export interface SelectedCodexToken {
  id: string
  sellerId: string
  accessToken: string
  accountId: string
  markupPct: number
}

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Select the cheapest healthy Codex ChatGPT token.
 * Decrypts the access token at selection time.
 * Refreshes if the token is older than 7 days.
 */
export async function selectCheapestCodexToken(): Promise<SelectedCodexToken> {
  const db = getDb()

  const available = await db.query.codexTokens.findMany({
    where: and(
      eq(codexTokens.isActive, true),
      eq(codexTokens.isHealthy, true),
    ),
    columns: {
      id: true,
      sellerId: true,
      encryptedAccessToken: true,
      accountId: true,
      markupPct: true,
      lastRefreshedAt: true,
    },
    orderBy: (tokens, { asc }) => [asc(tokens.markupPct)],
  })

  if (available.length === 0) {
    throw new NoHealthyKeysError()
  }

  const best = available[0]

  // Proactively refresh if older than 7 days
  if (best.lastRefreshedAt && Date.now() - best.lastRefreshedAt.getTime() > REFRESH_THRESHOLD_MS) {
    await refreshCodexToken(best.id).catch((err) =>
      console.error(`[codex-token] Proactive refresh failed for ${best.id}:`, err)
    )
    // Re-read the token after refresh
    const refreshed = await db.query.codexTokens.findFirst({
      where: eq(codexTokens.id, best.id),
      columns: { encryptedAccessToken: true },
    })
    if (refreshed) {
      return {
        id: best.id,
        sellerId: best.sellerId,
        accessToken: decryptApiKey(refreshed.encryptedAccessToken),
        accountId: best.accountId,
        markupPct: best.markupPct,
      }
    }
  }

  return {
    id: best.id,
    sellerId: best.sellerId,
    accessToken: decryptApiKey(best.encryptedAccessToken),
    accountId: best.accountId,
    markupPct: best.markupPct,
  }
}

/**
 * Select the next cheapest token, excluding the given IDs.
 */
export async function selectNextCodexToken(excludeIds: string[]): Promise<SelectedCodexToken> {
  const db = getDb()

  const available = await db.query.codexTokens.findMany({
    where: and(
      eq(codexTokens.isActive, true),
      eq(codexTokens.isHealthy, true),
    ),
    columns: {
      id: true,
      sellerId: true,
      encryptedAccessToken: true,
      accountId: true,
      markupPct: true,
    },
    orderBy: (tokens, { asc }) => [asc(tokens.markupPct)],
  })

  const filtered = available.filter((t) => !excludeIds.includes(t.id))

  if (filtered.length === 0) {
    throw new NoHealthyKeysError()
  }

  const best = filtered[0]
  return {
    id: best.id,
    sellerId: best.sellerId,
    accessToken: decryptApiKey(best.encryptedAccessToken),
    accountId: best.accountId,
    markupPct: best.markupPct,
  }
}

/**
 * Mark a Codex token as used.
 */
export async function recordCodexTokenUsage(tokenId: string) {
  const db = getDb()
  await db.update(codexTokens).set({ lastUsedAt: new Date() }).where(eq(codexTokens.id, tokenId))
}

/**
 * Mark a Codex token failure. Evict after 3 consecutive failures.
 */
export async function markCodexTokenFailure(tokenId: string) {
  const db = getDb()
  const token = await db.query.codexTokens.findFirst({
    where: eq(codexTokens.id, tokenId),
    columns: { failureCount: true, sellerId: true },
  })
  if (!token) return

  const newCount = token.failureCount + 1
  if (newCount >= 3) {
    await db.update(codexTokens).set({
      failureCount: newCount,
      isHealthy: false,
      isActive: false,
    }).where(eq(codexTokens.id, tokenId))
    console.warn(`[codex-token] Token ${tokenId} evicted (seller ${token.sellerId}) — 3 consecutive failures`)
  } else {
    await db.update(codexTokens).set({ failureCount: newCount }).where(eq(codexTokens.id, tokenId))
  }
}

/**
 * Mark a Codex token as healthy after a successful request.
 */
export async function markCodexTokenSuccess(tokenId: string) {
  const db = getDb()
  await db.update(codexTokens).set({
    failureCount: 0,
    isHealthy: true,
    lastUsedAt: new Date(),
  }).where(eq(codexTokens.id, tokenId))
}

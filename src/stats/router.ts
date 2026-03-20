import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { transactions, sellers, apiKeys, codexTokens, payouts } from '../db/schema'

const stats = new Hono()

/**
 * GET /stats — Public platform statistics.
 * Returns aggregate numbers only — no user data, no addresses, no keys.
 */
stats.get('/', async (c) => {
  const db = getDb()

  const [
    txnStats,
    sellerCount,
    apiKeyStats,
    codexTokenStats,
    payoutStats,
    modelBreakdown,
    endpointBreakdown,
    recentVolume,
  ] = await Promise.all([
    // Transaction totals
    db.select({
      totalTransactions: sql<number>`count(*)`,
      totalInputTokens: sql<number>`coalesce(sum(${transactions.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`coalesce(sum(${transactions.outputTokens}), 0)`,
      totalBuyerPaidUsd: sql<number>`coalesce(sum(${transactions.buyerPaidUsd}), 0)`,
      totalSellerEarnedUsd: sql<number>`coalesce(sum(${transactions.sellerEarnedUsd}), 0)`,
      totalPlatformFeeUsd: sql<number>`coalesce(sum(${transactions.platformFeeUsd}), 0)`,
      totalOpenaiCostUsd: sql<number>`coalesce(sum(${transactions.openaiCostUsd}), 0)`,
    }).from(transactions),

    // Seller count
    db.select({ count: sql<number>`count(*)` }).from(sellers),

    // API key stats
    db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when ${apiKeys.isActive} = 1 then 1 else 0 end)`,
      healthy: sql<number>`sum(case when ${apiKeys.isHealthy} = 1 and ${apiKeys.isActive} = 1 then 1 else 0 end)`,
    }).from(apiKeys),

    // Codex token stats
    db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when ${codexTokens.isActive} = 1 then 1 else 0 end)`,
      healthy: sql<number>`sum(case when ${codexTokens.isHealthy} = 1 and ${codexTokens.isActive} = 1 then 1 else 0 end)`,
    }).from(codexTokens),

    // Payout stats
    db.select({
      totalPayouts: sql<number>`count(*)`,
      totalPayoutUsd: sql<number>`coalesce(sum(${payouts.amountUsd}), 0)`,
      completedPayouts: sql<number>`sum(case when ${payouts.status} = 'completed' then 1 else 0 end)`,
    }).from(payouts),

    // Top models by usage
    db.select({
      model: transactions.model,
      requests: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${transactions.inputTokens}) + sum(${transactions.outputTokens}), 0)`,
      volumeUsd: sql<number>`coalesce(sum(${transactions.buyerPaidUsd}), 0)`,
    }).from(transactions)
      .groupBy(transactions.model)
      .orderBy(sql`count(*) desc`)
      .limit(10),

    // Endpoint breakdown
    db.select({
      endpoint: transactions.endpoint,
      requests: sql<number>`count(*)`,
      volumeUsd: sql<number>`coalesce(sum(${transactions.buyerPaidUsd}), 0)`,
    }).from(transactions)
      .groupBy(transactions.endpoint)
      .orderBy(sql`count(*) desc`),

    // Last 24h volume
    db.select({
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${transactions.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${transactions.outputTokens}), 0)`,
      volumeUsd: sql<number>`coalesce(sum(${transactions.buyerPaidUsd}), 0)`,
    }).from(transactions)
      .where(sql`${transactions.createdAt} > ${Math.floor(Date.now() / 1000) - 86400}`),
  ])

  const tx = txnStats[0]
  const totalTokens = (tx?.totalInputTokens || 0) + (tx?.totalOutputTokens || 0)

  return c.json({
    updated_at: new Date().toISOString(),
    overview: {
      total_transactions: tx?.totalTransactions || 0,
      total_tokens_processed: totalTokens,
      total_input_tokens: tx?.totalInputTokens || 0,
      total_output_tokens: tx?.totalOutputTokens || 0,
      total_volume_usd: Number((tx?.totalBuyerPaidUsd || 0).toFixed(6)),
      total_seller_earned_usd: Number((tx?.totalSellerEarnedUsd || 0).toFixed(6)),
      total_platform_fees_usd: Number((tx?.totalPlatformFeeUsd || 0).toFixed(6)),
      total_openai_cost_usd: Number((tx?.totalOpenaiCostUsd || 0).toFixed(6)),
    },
    supply: {
      total_sellers: sellerCount[0]?.count || 0,
      api_keys: {
        total: apiKeyStats[0]?.total || 0,
        active: apiKeyStats[0]?.active || 0,
        healthy: apiKeyStats[0]?.healthy || 0,
      },
      codex_tokens: {
        total: codexTokenStats[0]?.total || 0,
        active: codexTokenStats[0]?.active || 0,
        healthy: codexTokenStats[0]?.healthy || 0,
      },
    },
    payouts: {
      total: payoutStats[0]?.totalPayouts || 0,
      completed: payoutStats[0]?.completedPayouts || 0,
      total_usd: Number((payoutStats[0]?.totalPayoutUsd || 0).toFixed(6)),
    },
    last_24h: {
      requests: recentVolume[0]?.requests || 0,
      input_tokens: recentVolume[0]?.inputTokens || 0,
      output_tokens: recentVolume[0]?.outputTokens || 0,
      volume_usd: Number((recentVolume[0]?.volumeUsd || 0).toFixed(6)),
    },
    models: modelBreakdown.map((m) => ({
      model: m.model,
      requests: m.requests,
      total_tokens: m.totalTokens,
      volume_usd: Number((m.volumeUsd || 0).toFixed(6)),
    })),
    endpoints: endpointBreakdown.map((e) => ({
      endpoint: e.endpoint,
      requests: e.requests,
      volume_usd: Number((e.volumeUsd || 0).toFixed(6)),
    })),
  })
})

export { stats }

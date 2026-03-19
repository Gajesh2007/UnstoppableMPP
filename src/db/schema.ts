import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core'

export const sellers = sqliteTable('sellers', {
  id: text('id').primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  authTokenHash: text('auth_token_hash').notNull(),
  balance: real('balance').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id')
    .notNull()
    .references(() => sellers.id),
  // ECIES-encrypted API key (hex). Encrypted to the platform's public key by the seller.
  encryptedKey: text('encrypted_key').notNull(),
  spendingLimitUsd: real('spending_limit_usd'),
  spentUsd: real('spent_usd').default(0).notNull(),
  markupPct: real('markup_pct').default(0).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  isHealthy: integer('is_healthy', { mode: 'boolean' }).default(true).notNull(),
  failureCount: integer('failure_count').default(0).notNull(),
  lastHealthCheck: integer('last_health_check', { mode: 'timestamp' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const codexTokens = sqliteTable('codex_tokens', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id')
    .notNull()
    .references(() => sellers.id),
  // ECIES-encrypted tokens (hex). Encrypted to the platform's public key.
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  accountId: text('account_id').notNull(),       // ChatGPT-Account-ID header
  planType: text('plan_type'),                    // plus, pro, team, etc.
  email: text('email'),
  markupPct: real('markup_pct').default(0).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  isHealthy: integer('is_healthy', { mode: 'boolean' }).default(true).notNull(),
  failureCount: integer('failure_count').default(0).notNull(),
  lastRefreshedAt: integer('last_refreshed_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const modelPricing = sqliteTable('model_pricing', {
  id: text('id').primaryKey(),
  modelId: text('model_id').notNull().unique(),
  inputPricePerToken: real('input_price_per_token').notNull(),
  outputPricePerToken: real('output_price_per_token').notNull(),
  perImagePrice: real('per_image_price'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
})

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  buyerAddress: text('buyer_address'),
  apiKeyId: text('api_key_id').notNull(), // API key ID or Codex token ID
  sellerId: text('seller_id')
    .notNull()
    .references(() => sellers.id),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  openaiCostUsd: real('openai_cost_usd'),
  buyerPaidUsd: real('buyer_paid_usd').notNull(),
  sellerEarnedUsd: real('seller_earned_usd').notNull(),
  platformFeeUsd: real('platform_fee_usd').notNull(),
  endpoint: text('endpoint').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const payouts = sqliteTable('payouts', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id')
    .notNull()
    .references(() => sellers.id),
  amountUsd: real('amount_usd').notNull(),
  txHash: text('tx_hash'),
  status: text('status', { enum: ['pending', 'completed', 'failed'] })
    .default('pending')
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

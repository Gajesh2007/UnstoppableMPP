import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'
import * as schema from './schema'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let dbPath: string | null = null

export function resetDb() {
  db = null
  dbPath = null
}

export function getDb() {
  // If the configured path changed (e.g. between test files), re-initialize
  if (db && dbPath !== config.databasePath) {
    db = null
    dbPath = null
  }
  if (!db) {
    mkdirSync(dirname(config.databasePath), { recursive: true })

    const sqlite = new Database(config.databasePath)
    sqlite.run('PRAGMA journal_mode = WAL')
    sqlite.run('PRAGMA foreign_keys = ON')

    dbPath = config.databasePath
    db = drizzle(sqlite, { schema })

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS sellers (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        auth_token_hash TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL REFERENCES sellers(id),
        encrypted_key TEXT NOT NULL,
        spending_limit_usd REAL,
        spent_usd REAL NOT NULL DEFAULT 0,
        markup_pct REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_healthy INTEGER NOT NULL DEFAULT 1,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_health_check INTEGER,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS model_pricing (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL UNIQUE,
        input_price_per_token REAL NOT NULL,
        output_price_per_token REAL NOT NULL,
        per_image_price REAL,
        fetched_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        buyer_address TEXT,
        api_key_id TEXT NOT NULL REFERENCES api_keys(id),
        seller_id TEXT NOT NULL REFERENCES sellers(id),
        model TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        openai_cost_usd REAL,
        buyer_paid_usd REAL NOT NULL,
        seller_earned_usd REAL NOT NULL,
        platform_fee_usd REAL NOT NULL,
        endpoint TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL REFERENCES sellers(id),
        amount_usd REAL NOT NULL,
        tx_hash TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      )
    `)
  }

  return db
}

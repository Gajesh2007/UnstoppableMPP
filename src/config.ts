// Lazy getters — values are read from env at access time, not at module load.
export const config = {
  get port() { return Number(process.env.PORT || 3000) },
  get mnemonic() { return process.env.MNEMONIC || '' },
  get mppSecretKey() { return process.env.MPP_SECRET_KEY || '' },
  get platformFeePct() { return Number(process.env.PLATFORM_FEE_PCT || 1) },
  get databasePath() { return process.env.DATABASE_PATH || './data/unstoppable.db' },
  get pricingRefreshIntervalMin() { return Number(process.env.PRICING_REFRESH_INTERVAL_MIN || 60) },
  get tempoUsdcAddress() { return process.env.TEMPO_USDC_ADDRESS || '0x20c000000000000000000000b9537d11c60e8b50' },
  openaiBaseUrl: 'https://api.openai.com',
} as const

export function validateConfig() {
  if (!config.mnemonic) {
    throw new Error('MNEMONIC is required')
  }
  const words = config.mnemonic.trim().split(/\s+/)
  if (words.length !== 12 && words.length !== 24) {
    throw new Error('MNEMONIC must be a 12 or 24 word BIP-39 mnemonic')
  }
  if (!config.mppSecretKey) {
    throw new Error('MPP_SECRET_KEY is required. Generate one with: openssl rand -hex 32')
  }
}

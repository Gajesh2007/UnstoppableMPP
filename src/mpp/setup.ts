import { Mppx, tempo } from 'mppx/server'
import { config } from '../config'
import { getPlatformAddress } from '../crypto/platform'

let mppx: ReturnType<typeof Mppx.create<[ReturnType<typeof tempo>]>> | null = null

export function initMppx() {
  const recipient = getPlatformAddress()

  if (!config.mppSecretKey) {
    throw new Error('MPP_SECRET_KEY is required. Generate one with: openssl rand -hex 32')
  }

  mppx = Mppx.create({
    methods: [
      tempo({
        currency: config.tempoUsdcAddress,
        recipient,
        decimals: 6,
        sse: true,
      }),
    ],
    secretKey: config.mppSecretKey,
  })

  console.log(`[mpp] Initialized with recipient ${recipient}, currency ${config.tempoUsdcAddress}`)
}

export function getMppx() {
  if (!mppx) throw new Error('MPP not initialized — call initMppx()')
  return mppx
}

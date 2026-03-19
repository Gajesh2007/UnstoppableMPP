import { createConfig, http } from 'wagmi'
import { tempo } from 'viem/chains'
import { KeyManager, webAuthn } from 'wagmi/tempo'

export const wagmiConfig = createConfig({
  chains: [tempo],
  connectors: [webAuthn({
    keyManager: KeyManager.localStorage(),
  })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(),
  },
})

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://mpp.autonymlabs.org'

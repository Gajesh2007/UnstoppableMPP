import { mnemonicToAccount, HDKey } from 'viem/accounts'
import { mnemonicToSeedSync } from '@scure/bip39'
import { PrivateKey, decrypt as eciesDecrypt } from 'eciesjs'
import { config } from '../config'

let _account: ReturnType<typeof mnemonicToAccount> | null = null
let _eciesPrivateKey: PrivateKey | null = null

/**
 * Initialize platform keys from MNEMONIC.
 * Derives both the EVM wallet and secp256k1 ECIES keypair from the same seed.
 * Must be called once at startup after validateConfig().
 */
export function initPlatform() {
  _account = mnemonicToAccount(config.mnemonic)

  const seed = mnemonicToSeedSync(config.mnemonic)
  const hdKey = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")
  if (!hdKey.privateKey) throw new Error('Failed to derive private key from mnemonic')

  _eciesPrivateKey = new PrivateKey(Buffer.from(hdKey.privateKey))
}

/** Platform's Tempo/EVM wallet address */
export function getPlatformAddress(): `0x${string}` {
  if (!_account) throw new Error('Platform not initialized — call initPlatform()')
  return _account.address
}

/** Platform's secp256k1 public key (hex) — sellers encrypt API keys to this */
export function getPlatformPublicKey(): string {
  if (!_eciesPrivateKey) throw new Error('Platform not initialized — call initPlatform()')
  return _eciesPrivateKey.publicKey.toHex()
}

/** Decrypt an API key that was encrypted to the platform's public key (ECIES) */
export function decryptApiKey(encryptedHex: string): string {
  if (!_eciesPrivateKey) throw new Error('Platform not initialized — call initPlatform()')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decrypted = eciesDecrypt(_eciesPrivateKey.secret, encrypted)
  return Buffer.from(decrypted).toString('utf8')
}

/** The viem account for signing transactions (payouts, etc.) */
export function getPlatformAccount() {
  if (!_account) throw new Error('Platform not initialized — call initPlatform()')
  return _account
}

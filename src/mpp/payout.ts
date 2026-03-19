import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  type Hash,
} from 'viem'
import { tempo } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { privateKeyToAccount } from 'viem/accounts'
import { mnemonicToSeedSync } from '@scure/bip39'
import { HDKey } from 'viem/accounts'
import { nanoid } from 'nanoid'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { sellers, payouts } from '../db/schema'
import { config } from '../config'

let walletClient: ReturnType<typeof createWalletClient> | null = null
let publicClient: ReturnType<typeof createPublicClient> | null = null

function getClients() {
  if (!walletClient || !publicClient) {
    const seed = mnemonicToSeedSync(config.mnemonic)
    const hdKey = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")
    if (!hdKey.privateKey) throw new Error('Failed to derive private key')

    const account = privateKeyToAccount(
      `0x${Buffer.from(hdKey.privateKey).toString('hex')}`
    )

    walletClient = createWalletClient({
      account,
      chain: tempo,
      transport: http(),
    })

    publicClient = createPublicClient({
      chain: tempo,
      transport: http(),
    })
  }

  return { walletClient: walletClient!, publicClient: publicClient! }
}

/**
 * Execute an instant payout to a seller's wallet address.
 * Transfers TIP-20 stablecoin (pathUSD) on Tempo.
 * Returns the transaction hash or throws on failure.
 */
export async function executePayout(
  sellerId: string
): Promise<{ txHash: Hash; amount: number; payoutId: string }> {
  const db = getDb()

  // Get seller info
  const seller = await db.query.sellers.findFirst({
    where: eq(sellers.id, sellerId),
    columns: { balance: true, walletAddress: true },
  })

  if (!seller) throw new Error('Seller not found')
  if (seller.balance <= 0) {
    throw new Error('No balance to withdraw')
  }

  const payoutAmount = seller.balance
  const payoutId = nanoid()

  // Record pending payout
  await db.insert(payouts).values({
    id: payoutId,
    sellerId,
    amountUsd: payoutAmount,
    status: 'pending',
    createdAt: new Date(),
  })

  // Debit seller balance atomically
  await db
    .update(sellers)
    .set({ balance: 0, updatedAt: new Date() })
    .where(eq(sellers.id, sellerId))

  try {
    const { walletClient, publicClient } = getClients()

    // TIP-20 transfer: amount is in 6 decimals (USD stablecoin)
    const amountUnits = parseUnits(payoutAmount.toFixed(6), 6)

    const hash = await walletClient.sendTransaction({
      to: config.tempoUsdcAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: Abis.tip20,
        functionName: 'transfer',
        args: [seller.walletAddress as `0x${string}`, amountUnits],
      }),
    })

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'reverted') {
      // Refund the seller balance
      await db
        .update(sellers)
        .set({
          balance: sql`${sellers.balance} + ${payoutAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(sellers.id, sellerId))

      await db
        .update(payouts)
        .set({ status: 'failed' })
        .where(eq(payouts.id, payoutId))

      throw new Error(`Payout transaction reverted: ${hash}`)
    }

    // Mark payout as completed
    await db
      .update(payouts)
      .set({ txHash: hash, status: 'completed' })
      .where(eq(payouts.id, payoutId))

    console.log(`[payout] Sent $${payoutAmount.toFixed(6)} to ${seller.walletAddress} — tx: ${hash}`)

    return { txHash: hash, amount: payoutAmount, payoutId }
  } catch (err) {
    // If the transaction failed before broadcast, refund
    const payout = await db.query.payouts.findFirst({
      where: eq(payouts.id, payoutId),
      columns: { status: true },
    })

    if (payout?.status === 'pending') {
      await db
        .update(sellers)
        .set({
          balance: sql`${sellers.balance} + ${payoutAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(sellers.id, sellerId))

      await db
        .update(payouts)
        .set({ status: 'failed' })
        .where(eq(payouts.id, payoutId))
    }

    throw err
  }
}

/**
 * Get payout history for a seller.
 */
export async function getPayoutHistory(sellerId: string) {
  const db = getDb()
  return db.query.payouts.findMany({
    where: eq(payouts.sellerId, sellerId),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  })
}

'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConnectWallet } from '@/components/connect-wallet'
import { SellerDashboard } from '@/components/seller-dashboard'
import { BuyerGuide } from '@/components/buyer-guide'
import { DisclaimerModal } from '@/components/disclaimer-modal'

export default function Home() {
  const [authedAddress, setAuthedAddress] = useState<string | null>(null)

  return (
    <DisclaimerModal>
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">UnstoppableMPP</h1>
          <p className="text-muted-foreground">
            Unstoppable API Marketplace for Sovereign Agents
          </p>
          <p className="text-sm text-muted-foreground">
            If an agent has money to pay, there should always be a provider willing to service it.
          </p>
        </div>

        <Tabs defaultValue="buyer" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="buyer">Buyer</TabsTrigger>
            <TabsTrigger value="seller">Seller</TabsTrigger>
          </TabsList>

          <TabsContent value="buyer">
            <BuyerGuide />
          </TabsContent>

          <TabsContent value="seller" className="space-y-6">
            {!authedAddress ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <p className="text-muted-foreground">Connect your Tempo account to manage API keys</p>
                <ConnectWallet onAuth={setAuthedAddress} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Seller Dashboard</h2>
                  <ConnectWallet onAuth={setAuthedAddress} />
                </div>
                <SellerDashboard />
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-16 border-t pt-6 text-xs text-muted-foreground">
          <p>
            Research / Experimental. This software is provided for research purposes only. Use at your own risk.
          </p>
        </div>
      </div>
    </main>
    </DisclaimerModal>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { listKeys, addKey, delistKey, getPublicKey, getBalance, requestPayout } from '@/lib/api'
import { encrypt } from 'eciesjs'

interface ApiKey {
  id: string
  spendingLimitUsd: number | null
  spentUsd: number
  markupPct: number
  isActive: boolean
  isHealthy: boolean
  failureCount: number
  lastHealthCheck: string | null
  lastUsedAt: string | null
  createdAt: string
}

export function SellerDashboard() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add key form
  const [openaiKey, setOpenaiKey] = useState('')
  const [markupPct, setMarkupPct] = useState('-5')
  const [spendingLimit, setSpendingLimit] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payingOut, setPayingOut] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [keysData, balanceData] = await Promise.all([listKeys(), getBalance()])
      setKeys(keysData.keys)
      setBalance(balanceData.balance)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const { public_key } = await getPublicKey()
      const encryptedKey = Buffer.from(
        encrypt(public_key, Buffer.from(openaiKey))
      ).toString('hex')

      await addKey(
        encryptedKey,
        spendingLimit ? parseFloat(spendingLimit) : null,
        parseFloat(markupPct) || 0
      )

      setOpenaiKey('')
      setSpendingLimit('')
      setMarkupPct('-5')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add key')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelist(keyId: string) {
    try {
      await delistKey(keyId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delist key')
    }
  }

  async function handlePayout() {
    setPayingOut(true)
    setError('')
    try {
      const result = await requestPayout()
      alert(`Payout sent! $${result.amount_usd.toFixed(6)} — tx: ${result.tx_hash}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payout failed')
    } finally {
      setPayingOut(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {/* Balance */}
      <Card>
        <CardHeader>
          <CardTitle>Earnings</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-3xl font-bold">${balance.toFixed(6)}</span>
          <Button onClick={handlePayout} disabled={payingOut || balance <= 0}>
            {payingOut ? 'Sending...' : 'Withdraw'}
          </Button>
        </CardContent>
      </Card>

      {/* Add Key */}
      <Card>
        <CardHeader>
          <CardTitle>Add API Key</CardTitle>
          <CardDescription>
            Your key is encrypted to the platform&apos;s public key before leaving your browser. Only the TEE can decrypt it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddKey} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai-key">OpenAI API Key</Label>
              <Input
                id="openai-key"
                type="password"
                placeholder="sk-proj-..."
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="markup">Markup %</Label>
                <Input
                  id="markup"
                  type="number"
                  step="1"
                  placeholder="-10 = 10% discount"
                  value={markupPct}
                  onChange={(e) => setMarkupPct(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Negative = discount. 0 = at cost. Positive = premium.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="limit">Spending Limit (USD)</Label>
                <Input
                  id="limit"
                  type="number"
                  step="0.01"
                  placeholder="Leave empty for unlimited"
                  value={spendingLimit}
                  onChange={(e) => setSpendingLimit(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting || !openaiKey}>
              {submitting ? 'Encrypting & Submitting...' : 'Add Key'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Keys List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Keys</CardTitle>
          <CardDescription>{keys.length} key{keys.length !== 1 ? 's' : ''} registered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {keys.length === 0 && (
            <p className="text-sm text-muted-foreground">No keys yet. Add one above.</p>
          )}

          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{key.id.slice(0, 12)}...</span>
                  {key.isActive ? (
                    key.isHealthy ? (
                      <Badge variant="default" className="bg-green-600">Healthy</Badge>
                    ) : (
                      <Badge variant="destructive">Unhealthy</Badge>
                    )
                  ) : (
                    <Badge variant="secondary">Delisted</Badge>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Markup: {key.markupPct > 0 ? '+' : ''}{key.markupPct}%</span>
                  <span>Spent: ${key.spentUsd.toFixed(4)}{key.spendingLimitUsd ? ` / $${key.spendingLimitUsd.toFixed(2)}` : ''}</span>
                  {key.lastUsedAt && <span>Last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                </div>
              </div>

              {key.isActive && (
                <AlertDialog>
                  <AlertDialogTrigger>
                    <Button variant="outline" size="sm">Delist</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delist this key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently deactivate the key. It will no longer be used to serve requests. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelist(key.id)}>
                        Delist
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

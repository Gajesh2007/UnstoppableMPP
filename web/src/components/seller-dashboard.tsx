'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  listKeys, addKey, delistKey, getPublicKey, getBalance, requestPayout,
  importCodexTokens, startCodexLogin, pollCodexLogin, listCodexTokens, delistCodexToken,
} from '@/lib/api'
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

interface CodexToken {
  id: string
  accountId: string
  planType: string | null
  email: string | null
  markupPct: number
  isActive: boolean
  isHealthy: boolean
  failureCount: number
  lastRefreshedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

export function SellerDashboard() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [codexTokens, setCodexTokens] = useState<CodexToken[]>([])
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payingOut, setPayingOut] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [keysData, balanceData, codexData] = await Promise.all([
        listKeys(),
        getBalance(),
        listCodexTokens().catch(() => ({ tokens: [] })),
      ])
      setKeys(keysData.keys)
      setBalance(balanceData.balance)
      setCodexTokens(codexData.tokens)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

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

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{error}</div>
      )}

      {/* Balance */}
      <Card>
        <CardHeader><CardTitle>Earnings</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-3xl font-bold">${balance.toFixed(6)}</span>
          <Button onClick={handlePayout} disabled={payingOut || balance <= 0}>
            {payingOut ? 'Sending...' : 'Withdraw'}
          </Button>
        </CardContent>
      </Card>

      {/* Seller type tabs */}
      <Tabs defaultValue="apikey" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="apikey">API Key</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT Subscription</TabsTrigger>
        </TabsList>

        <TabsContent value="apikey">
          <ApiKeySection
            keys={keys}
            onRefresh={refresh}
            onError={setError}
          />
        </TabsContent>

        <TabsContent value="chatgpt">
          <ChatGptSection
            tokens={codexTokens}
            onRefresh={refresh}
            onError={setError}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// --- API Key Section ---

function ApiKeySection({
  keys, onRefresh, onError,
}: {
  keys: ApiKey[]
  onRefresh: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [openaiKey, setOpenaiKey] = useState('')
  const [markupPct, setMarkupPct] = useState('-5')
  const [spendingLimit, setSpendingLimit] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    onError('')
    try {
      const { public_key } = await getPublicKey()
      const encryptedKey = Buffer.from(
        encrypt(public_key, Buffer.from(openaiKey))
      ).toString('hex')
      await addKey(encryptedKey, spendingLimit ? parseFloat(spendingLimit) : null, parseFloat(markupPct) || 0)
      setOpenaiKey('')
      setSpendingLimit('')
      setMarkupPct('-5')
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add key')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelist(keyId: string) {
    try {
      await delistKey(keyId)
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delist key')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add API Key</CardTitle>
          <CardDescription>
            Your key is encrypted to the platform&apos;s public key before leaving your browser.
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
                <Input id="markup" type="number" step="1" placeholder="-10 = 10% discount"
                  value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} />
                <p className="text-xs text-muted-foreground">Negative = discount. 0 = at cost.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="limit">Spending Limit (USD)</Label>
                <Input id="limit" type="number" step="0.01" placeholder="Leave empty for unlimited"
                  value={spendingLimit} onChange={(e) => setSpendingLimit(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={submitting || !openaiKey}>
              {submitting ? 'Encrypting & Submitting...' : 'Add Key'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Keys</CardTitle>
          <CardDescription>{keys.length} key{keys.length !== 1 ? 's' : ''} registered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {keys.length === 0 && <p className="text-sm text-muted-foreground">No keys yet. Add one above.</p>}
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{key.id.slice(0, 12)}...</span>
                  {key.isActive ? (
                    key.isHealthy ? <Badge variant="default" className="bg-green-600">Healthy</Badge>
                      : <Badge variant="destructive">Unhealthy</Badge>
                  ) : <Badge variant="secondary">Delisted</Badge>}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Markup: {key.markupPct > 0 ? '+' : ''}{key.markupPct}%</span>
                  <span>Spent: ${key.spentUsd.toFixed(4)}{key.spendingLimitUsd ? ` / $${key.spendingLimitUsd.toFixed(2)}` : ''}</span>
                  {key.lastUsedAt && <span>Last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                </div>
              </div>
              {key.isActive && (
                <AlertDialog>
                  <AlertDialogTrigger><Button variant="outline" size="sm">Delist</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delist this key?</AlertDialogTitle>
                      <AlertDialogDescription>This will permanently deactivate the key.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelist(key.id)}>Delist</AlertDialogAction>
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

// --- ChatGPT Subscription Section ---

function ChatGptSection({
  tokens, onRefresh, onError,
}: {
  tokens: CodexToken[]
  onRefresh: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [tab, setTab] = useState<'import' | 'device'>('import')
  const [markupPct, setMarkupPct] = useState('5')
  const [submitting, setSubmitting] = useState(false)

  // Import form
  const [accessToken, setAccessToken] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [idToken, setIdToken] = useState('')

  // Device code form
  const [deviceAuthId, setDeviceAuthId] = useState('')
  const [userCode, setUserCode] = useState('')
  const [verificationUrl, setVerificationUrl] = useState('')
  const [polling, setPolling] = useState(false)
  const [pollStatus, setPollStatus] = useState('')

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    onError('')
    try {
      await importCodexTokens(accessToken, refreshToken, idToken, parseFloat(markupPct) || 0)
      setAccessToken('')
      setRefreshToken('')
      setIdToken('')
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to import tokens')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStartDevice() {
    setSubmitting(true)
    onError('')
    try {
      const result = await startCodexLogin()
      setDeviceAuthId(result.device_auth_id)
      setUserCode(result.user_code)
      setVerificationUrl(result.verification_url)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to start login')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePoll() {
    setPolling(true)
    setPollStatus('Waiting for authentication...')
    onError('')
    try {
      const result = await pollCodexLogin(deviceAuthId, userCode, parseFloat(markupPct) || 0)
      if (result.status === 'pending') {
        setPollStatus('Still waiting... Try again in a few seconds.')
      } else {
        setPollStatus(`Imported! ${result.email} (${result.plan_type})`)
        setDeviceAuthId('')
        setUserCode('')
        setVerificationUrl('')
        await onRefresh()
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Poll failed')
      setPollStatus('')
    } finally {
      setPolling(false)
    }
  }

  async function handleDelistToken(tokenId: string) {
    try {
      await delistCodexToken(tokenId)
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delist token')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add ChatGPT Subscription</CardTitle>
          <CardDescription>
            Share your ChatGPT Plus/Pro/Team Codex credits. Earn USDC for every request.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="codex-markup">Markup %</Label>
            <Input id="codex-markup" type="number" step="1" placeholder="5"
              value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} />
            <p className="text-xs text-muted-foreground">Applied on top of equivalent API pricing.</p>
          </div>

          <Separator />

          <div className="flex gap-2">
            <Button variant={tab === 'import' ? 'default' : 'outline'} size="sm" onClick={() => setTab('import')}>
              Paste from auth.json
            </Button>
            <Button variant={tab === 'device' ? 'default' : 'outline'} size="sm" onClick={() => setTab('device')}>
              Login with ChatGPT
            </Button>
          </div>

          {tab === 'import' && (
            <form onSubmit={handleImport} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Run <code className="bg-muted px-1 rounded">codex login</code> then <code className="bg-muted px-1 rounded">cat ~/.codex/auth.json</code> and paste the tokens below.
              </p>
              <div className="space-y-2">
                <Label htmlFor="access-token">access_token</Label>
                <Input id="access-token" type="password" placeholder="eyJ..."
                  value={accessToken} onChange={(e) => setAccessToken(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="refresh-token">refresh_token</Label>
                <Input id="refresh-token" type="password" placeholder="rt_..."
                  value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="id-token">id_token</Label>
                <Input id="id-token" type="password" placeholder="eyJ..."
                  value={idToken} onChange={(e) => setIdToken(e.target.value)} required />
              </div>
              <Button type="submit" disabled={submitting || !accessToken || !refreshToken || !idToken}>
                {submitting ? 'Importing...' : 'Import Tokens'}
              </Button>
            </form>
          )}

          {tab === 'device' && (
            <div className="space-y-3">
              {!deviceAuthId ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    No Codex CLI needed. We&apos;ll give you a code to enter on OpenAI&apos;s website.
                  </p>
                  <Button onClick={handleStartDevice} disabled={submitting}>
                    {submitting ? 'Starting...' : 'Start Login'}
                  </Button>
                </>
              ) : (
                <>
                  <div className="bg-muted rounded-md p-4 space-y-2">
                    <p className="text-sm font-semibold">1. Open this link:</p>
                    <a href={verificationUrl} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:underline break-all">{verificationUrl}</a>
                    <p className="text-sm font-semibold mt-3">2. Enter this code:</p>
                    <p className="text-2xl font-mono font-bold tracking-widest">{userCode}</p>
                    <p className="text-xs text-muted-foreground">Expires in 15 minutes.</p>
                  </div>
                  <Button onClick={handlePoll} disabled={polling}>
                    {polling ? 'Checking...' : 'Check if authenticated'}
                  </Button>
                  {pollStatus && <p className="text-sm text-muted-foreground">{pollStatus}</p>}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Codex Tokens</CardTitle>
          <CardDescription>{tokens.length} token{tokens.length !== 1 ? 's' : ''} registered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">No tokens yet. Add one above.</p>
          )}
          {tokens.map((token) => (
            <div key={token.id} className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{token.email || token.accountId.slice(0, 12) + '...'}</span>
                  {token.planType && <Badge variant="outline">{token.planType}</Badge>}
                  {token.isActive ? (
                    token.isHealthy ? <Badge variant="default" className="bg-green-600">Healthy</Badge>
                      : <Badge variant="destructive">Unhealthy</Badge>
                  ) : <Badge variant="secondary">Delisted</Badge>}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Markup: {token.markupPct > 0 ? '+' : ''}{token.markupPct}%</span>
                  {token.lastRefreshedAt && <span>Refreshed: {new Date(token.lastRefreshedAt).toLocaleDateString()}</span>}
                  {token.lastUsedAt && <span>Last used: {new Date(token.lastUsedAt).toLocaleDateString()}</span>}
                </div>
              </div>
              {token.isActive && (
                <AlertDialog>
                  <AlertDialogTrigger><Button variant="outline" size="sm">Delist</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delist this token?</AlertDialogTitle>
                      <AlertDialogDescription>This will permanently deactivate the token.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelistToken(token.id)}>Delist</AlertDialogAction>
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

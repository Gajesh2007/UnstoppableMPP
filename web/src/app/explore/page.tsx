'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { API_BASE } from '@/lib/config'
import Link from 'next/link'

interface Stats {
  updated_at: string
  overview: {
    total_transactions: number
    total_tokens_processed: number
    total_input_tokens: number
    total_output_tokens: number
    total_volume_usd: number
    total_seller_earned_usd: number
    total_platform_fees_usd: number
    total_openai_cost_usd: number
  }
  supply: {
    total_sellers: number
    api_keys: { total: number; active: number; healthy: number }
    codex_tokens: { total: number; active: number; healthy: number }
  }
  payouts: {
    total: number
    completed: number
    total_usd: number
  }
  last_24h: {
    requests: number
    input_tokens: number
    output_tokens: number
    volume_usd: number
  }
  models: Array<{
    model: string
    requests: number
    total_tokens: number
    volume_usd: number
  }>
  endpoints: Array<{
    endpoint: string
    requests: number
    volume_usd: number
  }>
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatUsd(n: number): string {
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(2) + 'K'
  if (n >= 1) return '$' + n.toFixed(2)
  if (n >= 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(6)
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold tracking-tight font-mono">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Pulse() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
    </span>
  )
}

export default function ExplorePage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setStats(data)
      setLastFetch(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 5000) // Refresh every 5s
    return () => clearInterval(interval)
  }, [fetchStats])

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-10 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                &larr; Back
              </Link>
              <h1 className="text-3xl font-bold tracking-tight mt-1">Explore</h1>
              <p className="text-muted-foreground">Live platform statistics</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Pulse />
              {lastFetch ? `Updated ${lastFetch.toLocaleTimeString()}` : 'Loading...'}
            </div>
          </div>
        </div>

        {error && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="pt-4">
              <p className="text-sm text-destructive">Failed to load stats: {error}</p>
            </CardContent>
          </Card>
        )}

        {stats && (
          <div className="space-y-6">
            {/* Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>All-time platform totals</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <StatCard
                    label="Transactions"
                    value={formatNumber(stats.overview.total_transactions)}
                  />
                  <StatCard
                    label="Tokens Processed"
                    value={formatNumber(stats.overview.total_tokens_processed)}
                    sub={`${formatNumber(stats.overview.total_input_tokens)} in / ${formatNumber(stats.overview.total_output_tokens)} out`}
                  />
                  <StatCard
                    label="Volume"
                    value={formatUsd(stats.overview.total_volume_usd)}
                    sub="Total buyer spend"
                  />
                  <StatCard
                    label="Seller Earnings"
                    value={formatUsd(stats.overview.total_seller_earned_usd)}
                    sub={`${formatUsd(stats.overview.total_platform_fees_usd)} fees`}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Last 24h */}
            <Card>
              <CardHeader>
                <CardTitle>Last 24 Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <StatCard
                    label="Requests"
                    value={formatNumber(stats.last_24h.requests)}
                  />
                  <StatCard
                    label="Input Tokens"
                    value={formatNumber(stats.last_24h.input_tokens)}
                  />
                  <StatCard
                    label="Output Tokens"
                    value={formatNumber(stats.last_24h.output_tokens)}
                  />
                  <StatCard
                    label="Volume"
                    value={formatUsd(stats.last_24h.volume_usd)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Supply */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Sellers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{stats.supply.total_sellers}</p>
                  <p className="text-xs text-muted-foreground mt-1">Registered providers</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>API Keys</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{stats.supply.api_keys.total}</p>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="secondary">{stats.supply.api_keys.active} active</Badge>
                    <Badge variant="outline">{stats.supply.api_keys.healthy} healthy</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Codex Tokens</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{stats.supply.codex_tokens.total}</p>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="secondary">{stats.supply.codex_tokens.active} active</Badge>
                    <Badge variant="outline">{stats.supply.codex_tokens.healthy} healthy</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Payouts */}
            <Card>
              <CardHeader>
                <CardTitle>Payouts</CardTitle>
                <CardDescription>Seller withdrawals via Tempo</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-6">
                  <StatCard label="Total Payouts" value={String(stats.payouts.total)} />
                  <StatCard label="Completed" value={String(stats.payouts.completed)} />
                  <StatCard label="Total Paid" value={formatUsd(stats.payouts.total_usd)} />
                </div>
              </CardContent>
            </Card>

            {/* Models */}
            {stats.models.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Models</CardTitle>
                  <CardDescription>Usage by model</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.models.map((m) => (
                      <div key={m.model} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{m.model}</code>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{formatNumber(m.requests)} req</span>
                          <span>{formatNumber(m.total_tokens)} tok</span>
                          <span className="font-mono text-foreground">{formatUsd(m.volume_usd)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Endpoints */}
            {stats.endpoints.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Endpoints</CardTitle>
                  <CardDescription>Usage by API endpoint</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.endpoints.map((e) => (
                      <div key={e.endpoint} className="flex items-center justify-between">
                        <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{e.endpoint}</code>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{formatNumber(e.requests)} req</span>
                          <span className="font-mono text-foreground">{formatUsd(e.volume_usd)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="mt-16 border-t pt-6 text-xs text-muted-foreground">
          <p>
            Research / Experimental. This software is provided for research purposes only. Use at your own risk.
          </p>
        </div>
      </div>
    </main>
  )
}

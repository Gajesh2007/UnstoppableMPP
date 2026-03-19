'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export function BuyerGuide() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
          <CardDescription>Swap your base URL. Pay with USDC. That&apos;s it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h3 className="font-semibold">1. Install Tempo CLI</h3>
            <pre className="bg-muted rounded-md p-3 text-sm overflow-x-auto">
              curl -sSL https://tempo.xyz/install | bash
            </pre>
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="font-semibold">2. Fund your wallet</h3>
            <pre className="bg-muted rounded-md p-3 text-sm overflow-x-auto">
{`tempo wallet login
tempo wallet fund`}
            </pre>
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="font-semibold">3. Make requests</h3>
            <p className="text-sm text-muted-foreground">
              Same as OpenAI — just use <code className="bg-muted px-1 rounded">tempo request</code> instead of <code className="bg-muted px-1 rounded">curl</code>.
              Payment happens automatically.
            </p>
            <pre className="bg-muted rounded-md p-3 text-sm overflow-x-auto">
{`tempo request -t -X POST \\
  --json '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "hello"}]
  }' \\
  https://mpp.autonymlabs.org/v1/chat/completions`}
            </pre>
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="font-semibold">4. Or use mppx CLI</h3>
            <pre className="bg-muted rounded-md p-3 text-sm overflow-x-auto">
{`npx mppx https://mpp.autonymlabs.org/v1/chat/completions \\
  -X POST --json '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "hello"}]
  }'`}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supported Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1">
              <code>GET /v1/models</code>
              <span className="text-muted-foreground">Free</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>POST /v1/chat/completions</code>
              <span className="text-muted-foreground">Dynamic pricing</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>POST /v1/embeddings</code>
              <span className="text-muted-foreground">Dynamic pricing</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>POST /v1/images/generations</code>
              <span className="text-muted-foreground">Dynamic pricing</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>ALL /v1/*</code>
              <span className="text-muted-foreground">All OpenAI endpoints supported</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How Payment Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>
            When you hit any paid endpoint, the server returns <code className="bg-muted px-1 rounded">402 Payment Required</code> with
            an MPP challenge. Your Tempo wallet or mppx client automatically pays in USDC on the Tempo blockchain (~500ms finality),
            then retries the request with a payment proof. The server verifies and proxies to OpenAI.
          </p>
          <p>
            You only pay for what you use. Pricing is based on the model&apos;s current OpenAI rates plus the seller&apos;s markup (which can be negative — a discount).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

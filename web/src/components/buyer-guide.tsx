'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'

export function BuyerGuide() {
  return (
    <Tabs defaultValue="api" className="space-y-6">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="api">Direct API</TabsTrigger>
        <TabsTrigger value="codex">Codex</TabsTrigger>
      </TabsList>

      <TabsContent value="api">
        <DirectApiBuyer />
      </TabsContent>

      <TabsContent value="codex">
        <CodexBuyer />
      </TabsContent>
    </Tabs>
  )
}

function DirectApiBuyer() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Direct API Access</CardTitle>
          <CardDescription>Drop-in replacement for OpenAI. Swap your base URL, pay with USDC.</CardDescription>
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
              <span className="text-muted-foreground">Per-token pricing</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>POST /v1/embeddings</code>
              <span className="text-muted-foreground">Per-token pricing</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>POST /v1/images/generations</code>
              <span className="text-muted-foreground">Per-image pricing</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>ALL /v1/*</code>
              <span className="text-muted-foreground">All OpenAI endpoints</span>
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
            an MPP challenge. Your Tempo wallet automatically pays in USDC on the Tempo blockchain (~500ms finality),
            then retries with payment proof.
          </p>
          <p>
            You only pay for what you use. Pricing matches OpenAI&apos;s rates plus the seller&apos;s markup.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function CodexBuyer() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Codex Access</CardTitle>
          <CardDescription>
            Use OpenAI Codex models (gpt-5.3-codex) through ChatGPT subscription credits.
            No API key needed — sellers share their ChatGPT Plus/Pro/Team subscription.
          </CardDescription>
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
            <h3 className="font-semibold">3. Make a Codex request</h3>
            <p className="text-sm text-muted-foreground">
              Uses the OpenAI Responses API format. Supports streaming and non-streaming.
              Works with <code className="bg-muted px-1 rounded">gpt-5.3-codex</code> and <code className="bg-muted px-1 rounded">gpt-5.4</code>.
            </p>
            <pre className="bg-muted rounded-md p-3 text-sm overflow-x-auto">
{`# Non-streaming (returns complete JSON)
tempo request -t -X POST \\
  --json '{
    "model": "gpt-5.3-codex",
    "instructions": "You are a helpful assistant.",
    "input": [{
      "type": "message",
      "role": "user",
      "content": [{"type": "input_text", "text": "Explain TEEs (Trusted Execution Environments)"}]
    }],
    "stream": false
  }' \\
  https://mpp.autonymlabs.org/codex/responses`}
            </pre>
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="font-semibold">4. Or use with Codex CLI</h3>
            <p className="text-sm text-muted-foreground">
              Run the local sidecar proxy to connect Codex CLI through MPP payments.
              The sidecar uses your Tempo wallet to pay automatically.
            </p>
            <pre className="bg-muted rounded-md p-3 text-sm overflow-x-auto">
{`# Clone and start the sidecar
git clone https://github.com/Gajesh2007/UnstoppableMPP.git
cd UnstoppableMPP
bun install
bun run sidecar

# In a separate terminal, configure Codex CLI
# Add to ~/.codex/config.toml:
[model_providers.unstoppable]
name = "UnstoppableMPP"
base_url = "http://localhost:4111"
env_key = "UNSTOPPABLE_DUMMY"
wire_api = "responses"

# Then run Codex with the provider
codex --provider unstoppable`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Requires <a href="https://bun.sh" target="_blank" rel="noopener noreferrer" className="underline">Bun</a> and
              a funded <a href="https://tempo.xyz" target="_blank" rel="noopener noreferrer" className="underline">Tempo wallet</a>.
              The sidecar handles MPP payment sessions transparently between Codex and the marketplace.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supported Models</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1">
              <code>gpt-5.3-codex</code>
              <span className="text-muted-foreground">Codex-optimized, fast</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>gpt-5.4</code>
              <span className="text-muted-foreground">Latest flagship model</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1">
              <code>POST /codex/responses</code>
              <span className="text-muted-foreground">Responses API (streaming + non-streaming)</span>
            </div>
            <Separator />
            <div className="flex justify-between py-1">
              <code>GET /codex/</code>
              <span className="text-muted-foreground">Health / info</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Billed exactly like OpenAI&apos;s API pricing plus seller markup:</p>
          <div className="bg-muted rounded-md p-3 space-y-1 font-mono text-xs">
            <div className="flex justify-between font-semibold text-foreground border-b border-foreground/10 pb-1 mb-1">
              <span>Model</span>
              <span>Input / Cached / Output</span>
            </div>
            <div className="flex justify-between">
              <span>gpt-5.3-codex</span>
              <span className="text-foreground">$1.75 / $0.175 / $14.00</span>
            </div>
            <div className="flex justify-between">
              <span>gpt-5.4</span>
              <span className="text-foreground">$2.00 / $0.50 / $8.00</span>
            </div>
          </div>
          <p className="text-xs">
            Per 1M tokens. Input, cached input, and output tokens are charged separately based on actual usage.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

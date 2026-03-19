# UnstoppableMPP

A decentralized API key marketplace. Sellers list their unused OpenAI API keys with custom pricing. Buyers just swap their base URL and pay per-request with stablecoins on [Tempo](https://tempo.xyz) via the [Machine Payments Protocol](https://mpp.dev).

No accounts. No credit cards. No middlemen. Just swap the URL and go.

```
# Before (OpenAI direct)
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]}'

# After (UnstoppableMPP -- pay with Tempo wallet)
tempo request -t -X POST \
  --json '{"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]}' \
  https://your-deployment.com/v1/chat/completions
```

The buyer pays in USDC. The seller gets paid instantly. The platform takes 5%.

## How It Works

```
Buyer                          UnstoppableMPP                    OpenAI
  |                                  |                              |
  |  POST /v1/chat/completions       |                              |
  |--------------------------------->|                              |
  |                                  |                              |
  |  402 Payment Required            |                              |
  |  (MPP challenge: $0.003 USDC)    |                              |
  |<---------------------------------|                              |
  |                                  |                              |
  |  Payment (on-chain, ~500ms)      |                              |
  |--------------------------------->|                              |
  |                                  |  Forward with seller's key   |
  |                                  |----------------------------->|
  |                                  |                              |
  |                                  |  Response                    |
  |                                  |<-----------------------------|
  |  Response + Payment Receipt      |                              |
  |<---------------------------------|                              |
  |                                  |                              |
  |                                  |  Credit seller balance       |
```

- **All `/v1/*` endpoints** are supported -- chat, embeddings, images, audio, assistants, everything
- **Cheapest key first** -- the marketplace always routes through the lowest-priced healthy key
- **Automatic failover** -- if a key is banned, rate-limited, or exhausted, the next one is tried instantly
- **Streaming works** -- SSE passthrough with per-token usage tracking

## For Sellers

You have unused OpenAI credits? Maybe you bought too many, or your company is winding down. List your key and earn USDC.

```bash
# 1. Get the platform's public key
curl https://your-deployment.com/marketplace/public-key
# {"public_key": "038318..."}

# 2. Register as a seller
curl -X POST https://your-deployment.com/marketplace/sellers \
  -H 'Content-Type: application/json' \
  -d '{"wallet_address": "0xYourTempoWallet"}'
# Returns: auth_token (save this!) + public_key

# 3. Encrypt your OpenAI key to the platform's public key (ECIES)
#    This ensures only the TEE can decrypt it -- not even the operator
npx eciesjs encrypt <public_key> <your-openai-key>

# 4. Submit the encrypted key with your pricing
curl -X POST https://your-deployment.com/marketplace/keys \
  -H 'Authorization: Bearer <auth_token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "encrypted_key": "<hex-encrypted-key>",
    "markup_pct": -10,
    "spending_limit_usd": 50.00
  }'

# markup_pct: -10 = 10% discount, 0 = at cost, 20 = 20% premium
# spending_limit_usd: max the platform can spend through your key (null = unlimited)
```

### Seller API

| Endpoint | Description |
|---|---|
| `GET /marketplace/public-key` | Platform's ECIES public key (encrypt your API key to this) |
| `POST /marketplace/sellers` | Register as a seller |
| `POST /marketplace/keys` | Submit an encrypted API key |
| `GET /marketplace/keys` | List your keys + health status |
| `PATCH /marketplace/keys/:id` | Update pricing or spending limit |
| `DELETE /marketplace/keys/:id` | Deactivate a key |
| `GET /marketplace/balance` | Check your earnings |
| `POST /marketplace/payout` | Instant withdrawal to your Tempo wallet |
| `GET /marketplace/payouts` | Payout history |

## For Buyers

Swap your base URL. That's it.

```bash
# Using tempo CLI (handles MPP payment automatically)
tempo request -t -X POST \
  --json '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}' \
  https://your-deployment.com/v1/chat/completions

# Using mppx CLI
npx mppx https://your-deployment.com/v1/chat/completions \
  -X POST --json '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

Any MPP-compatible client works. The server returns a standard `402 Payment Required` with a `WWW-Authenticate: Payment` header -- the client handles the rest.

`GET /v1/models` is free (no payment required).

## Security

**API keys are encrypted end-to-end.** Sellers encrypt their OpenAI keys using ECIES to the platform's secp256k1 public key. The private key exists only inside the TEE (Trusted Execution Environment). Not even the operator can extract it.

**Deployed on [EigenLayer eCloud](https://docs.eigenlayer.xyz/eigenlayer/ecloud)** -- a TEE compute platform with hardware attestation. The mnemonic (which derives both the wallet and the encryption keypair) never leaves the enclave.

**MPP best practices enforced:**
- TLS 1.2+ required (Caddy terminates TLS)
- `Cache-Control: no-store` on 402 challenges
- `Cache-Control: private` on receipted responses
- Payment credentials never logged or cached
- Idempotency-Key support for safe retries
- Challenge IDs are HMAC-bound (not guessable)

## Deploy on eCloud

### Prerequisites

- [eCloud CLI](https://docs.eigenlayer.xyz/eigenlayer/ecloud) installed and authenticated
- A funded Tempo wallet (for seller payouts)
- A domain name

### 1. Clone and configure

```bash
git clone https://github.com/Gajesh2007/UnstoppableMPP.git
cd UnstoppableMPP
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Generate a mnemonic (this derives your wallet + encryption keys)
bun -e "import{generateMnemonic}from'@scure/bip39';import{wordlist}from'@scure/bip39/wordlists/english';console.log(generateMnemonic(wordlist))"

# Generate MPP secret key
openssl rand -hex 32
```

```env
MNEMONIC=<your 12-word mnemonic>
MPP_SECRET_KEY=<your 64-char hex key>
PORT=3000
PLATFORM_FEE_PCT=5
```

### 3. Configure TLS

```bash
ecloud compute app configure tls
cat .env.example.tls >> .env
```

Edit `.env` and set `DOMAIN=yourdomain.com`.

### 4. Deploy

```bash
ecloud compute app deploy \
  --name unstoppable-mpp \
  --dockerfile Dockerfile \
  --env-file .env \
  --verifiable \
  --repo https://github.com/Gajesh2007/UnstoppableMPP.git \
  --commit $(git rev-parse HEAD)
```

### 5. Point DNS

Get your instance IP:

```bash
ecloud compute app list
```

Create an A record: `yourdomain.com -> <instance-ip>`

### 6. Fund the platform wallet

Start the app and check the platform address:

```bash
curl https://yourdomain.com/
# {"platform_address": "0x...", ...}
```

Send USDC on Tempo to that address. This is the balance used for seller payouts.

### Upgrading

```bash
git pull
ecloud compute app upgrade
```

## Development

```bash
bun install

# Run locally
MNEMONIC="test test test test test test test test test test test junk" \
MPP_SECRET_KEY=$(openssl rand -hex 32) \
bun run src/index.ts

# Run tests (uses real OpenAI key from OPENAI_API_KEY env var for e2e)
bun test
```

## Architecture

```
src/
  index.ts              # Hono app entry point
  config.ts             # Lazy env config
  crypto/platform.ts    # MNEMONIC -> wallet + ECIES keypair
  db/                   # SQLite via Drizzle ORM
  marketplace/          # Seller registration, key CRUD, auth
  proxy/                # Wildcard /v1/* proxy, key selection, streaming
  pricing/              # Live model pricing from OpenRouter, price calculator
  health/               # Periodic + real-time key health monitoring
  mpp/                  # MPP setup, instant Tempo payouts
  middleware/           # Rate limiting, idempotency, security headers
```

**Stack:** Bun, Hono, mppx, Drizzle/SQLite, Viem, eciesjs

## License

MIT

# UnstoppableMPP

**Unstoppable API Marketplace for Sovereign Agents.**

> **Research / Experimental** -- This project is in its experimental phase and is intended for research purposes only. Use at your own risk.

Sovereign agents shouldn't be cut off from the web. If an agent has money to pay, there should always be a provider willing to service it. No bans. No gatekeeping. No single point of failure. That's the thesis.

UnstoppableMPP is a decentralized API key marketplace. Sellers list their unused OpenAI API keys with custom pricing. Buyers -- whether human or autonomous agent -- just swap their base URL and pay per-request with stablecoins on [Tempo](https://tempo.xyz) via the [Machine Payments Protocol](https://mpp.dev).

No accounts. No credit cards. No middlemen. Just swap the URL and go.

```
# Before (OpenAI direct)
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -d '{"model": "gpt-5.4", "messages": [{"role": "user", "content": "hello"}]}'

# After (UnstoppableMPP -- pay with Tempo wallet)
tempo request -t -X POST \
  --json '{"model": "gpt-5.4", "messages": [{"role": "user", "content": "hello"}]}' \
  https://mpp.autonymlabs.org/v1/chat/completions
```

The buyer pays in USDC. The seller gets paid instantly. The platform takes 1%.

## How It Works

```
Buyer                          UnstoppableMPP                    OpenAI
  |                                  |                              |
  |  POST /v1/chat/completions       |                              |
  |--------------------------------->|                              |
  |                                  |                              |
  |  402 (MPP session challenge)     |                              |
  |<---------------------------------|                              |
  |                                  |                              |
  |  Open session (deposit USDC)     |                              |
  |--------------------------------->|                              |
  |                                  |  Forward with seller's key   |
  |                                  |----------------------------->|
  |                                  |                              |
  |                                  |  Response (stream or full)   |
  |                                  |<-----------------------------|
  |  Response + Receipt              |                              |
  |<---------------------------------|                              |
  |                                  |  Charge actual cost (voucher)|
  |                                  |  Credit seller balance       |
```

Buyers open a **session** with a deposit (e.g. $1 USDC). Each request charges the **actual cost** via off-chain vouchers -- no upfront estimation, no overpaying. Unused deposit is refunded when the session closes. For streaming, tokens are metered as they arrive.

- **All `/v1/*` endpoints** are supported -- chat, embeddings, images, audio, assistants, everything
- **Cheapest key first** -- the marketplace always routes through the lowest-priced healthy key
- **Automatic failover** -- if a key is banned, rate-limited, or exhausted, the next one is tried instantly
- **Streaming works** -- SSE passthrough with per-token usage tracking

## For Sellers

You have unused OpenAI credits? Maybe you bought too many, or your company is winding down. List your key and earn USDC.

Use the web dashboard or the API directly:

```bash
# 1. Authenticate with your Tempo wallet (sign a nonce)
NONCE=$(curl -s -X POST https://mpp.autonymlabs.org/marketplace/auth/nonce \
  -H 'Content-Type: application/json' \
  -d '{"address": "0xYourWallet"}' | jq -r '.nonce')

# Sign the message with your wallet, then verify to get a session token
TOKEN=$(curl -s -X POST https://mpp.autonymlabs.org/marketplace/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"address": "0xYourWallet", "signature": "<signed-message>", "nonce": "'$NONCE'"}' \
  | jq -r '.token')

# 2. Get the platform's public key
curl https://mpp.autonymlabs.org/marketplace/public-key
# {"public_key": "038318..."}

# 3. Encrypt your OpenAI key to the platform's public key (ECIES)
#    This ensures only the TEE can decrypt it -- not even the operator
npx eciesjs encrypt <public_key> <your-openai-key>

# 4. Submit the encrypted key with your pricing
curl -X POST https://mpp.autonymlabs.org/marketplace/keys \
  -H "Authorization: Bearer $TOKEN" \
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
| `POST /marketplace/auth/nonce` | Get a nonce to sign for wallet authentication |
| `POST /marketplace/auth/verify` | Verify signature and get session token |
| `POST /marketplace/keys` | Submit an encrypted API key |
| `GET /marketplace/keys` | List your keys + health status |
| `PATCH /marketplace/keys/:id` | Update pricing or spending limit |
| `DELETE /marketplace/keys/:id` | Delist a key |
| `GET /marketplace/balance` | Check your earnings |
| `POST /marketplace/payout` | Instant withdrawal to your Tempo wallet |
| `GET /marketplace/payouts` | Payout history |

## For Buyers

Swap your base URL. That's it.

```bash
# Using tempo CLI (handles MPP payment automatically)
tempo request -t -X POST \
  --json '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"hello"}]}' \
  https://mpp.autonymlabs.org/v1/chat/completions

# Using mppx CLI
npx mppx https://mpp.autonymlabs.org/v1/chat/completions \
  -X POST --json '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"hello"}]}'
```

Any MPP-compatible client works. The server returns a standard `402 Payment Required` with a `WWW-Authenticate: Payment` header -- the client handles the rest.

`GET /v1/models` is free (no payment required).

## Security

**API keys are encrypted end-to-end.** Sellers encrypt their OpenAI keys using ECIES to the platform's secp256k1 public key. The private key exists only inside the TEE (Trusted Execution Environment). Not even the operator can extract it.

**Deployed on [EigenCloud](https://docs.eigencloud.xyz)** -- a TEE compute platform with hardware attestation. The mnemonic (which derives both the wallet and the encryption keypair) never leaves the enclave.

**MPP best practices enforced:**
- TLS 1.2+ required (Caddy terminates TLS)
- `Cache-Control: no-store` on 402 challenges
- `Cache-Control: private` on receipted responses
- Payment credentials never logged or cached
- Idempotency-Key support for safe retries
- Challenge IDs are HMAC-bound (not guessable)

## Deploy on EigenCloud

### Prerequisites

- [EigenCloud CLI](https://docs.eigencloud.xyz) installed and authenticated
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
PLATFORM_FEE_PCT=1
```

### 3. Configure TLS

```bash
ecloud compute app configure tls
cat .env.example.tls >> .env
```

Edit `.env` and set `DOMAIN=yourdomain.com`.

### 4. Deploy

```bash
ecloud compute app deploy
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

## Disclaimer

This software is experimental and provided for research purposes only. It is not intended for production use in regulated environments. The authors make no guarantees about availability, correctness, or security. Users are responsible for complying with all applicable terms of service and laws in their jurisdiction. Use at your own risk.


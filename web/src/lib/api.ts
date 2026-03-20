import { API_BASE } from './config'

let sessionToken: string | null = null

export function setSessionToken(token: string | null) {
  sessionToken = token
  if (token) {
    localStorage.setItem('mpp_session', token)
  } else {
    localStorage.removeItem('mpp_session')
  }
}

export function getSessionToken(): string | null {
  if (sessionToken) return sessionToken
  if (typeof window !== 'undefined') {
    sessionToken = localStorage.getItem('mpp_session')
  }
  return sessionToken
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getSessionToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}/marketplace${path}`, { ...options, headers })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function getNonce(address: string) {
  return apiFetch('/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ address }),
  })
}

export async function verifySignature(address: string, signature: string, nonce: string) {
  return apiFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ address, signature, nonce }),
  })
}

export async function getPublicKey() {
  return apiFetch('/public-key')
}

export async function addKey(encrypted_key: string, spending_limit_usd: number | null, markup_pct: number) {
  return apiFetch('/keys', {
    method: 'POST',
    body: JSON.stringify({ encrypted_key, spending_limit_usd, markup_pct }),
  })
}

export async function listKeys() {
  return apiFetch('/keys')
}

export async function delistKey(keyId: string) {
  return apiFetch(`/keys/${keyId}`, { method: 'DELETE' })
}

export async function getBalance() {
  return apiFetch('/balance')
}

export async function requestPayout() {
  return apiFetch('/payout', { method: 'POST' })
}

// --- Codex token endpoints ---

export async function importCodexTokens(
  accessToken: string,
  refreshToken: string,
  idToken: string,
  markupPct: number
) {
  return apiFetch('/codex/import', {
    method: 'POST',
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      markup_pct: markupPct,
    }),
  })
}

export async function startCodexLogin() {
  return apiFetch('/codex/login', { method: 'POST' })
}

export async function pollCodexLogin(deviceAuthId: string, userCode: string, markupPct: number) {
  return apiFetch('/codex/poll', {
    method: 'POST',
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
      markup_pct: markupPct,
    }),
  })
}

export async function listCodexTokens() {
  return apiFetch('/codex/tokens')
}

export async function delistCodexToken(tokenId: string) {
  return apiFetch(`/codex/tokens/${tokenId}`, { method: 'DELETE' })
}

import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'UnstoppableMPP — Unstoppable API Marketplace for Sovereign Agents'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              fontSize: '64px',
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-2px',
              lineHeight: 1.1,
            }}
          >
            UnstoppableMPP
          </div>
          <div
            style={{
              fontSize: '28px',
              color: '#a0a0b0',
              lineHeight: 1.4,
              maxWidth: '800px',
            }}
          >
            Decentralized API marketplace for sovereign agents. OpenAI, Codex, and ChatGPT credits — pay per token with USDC.
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
            {['gpt-5.3-codex', 'gpt-5.4', 'dall-e-3'].map((model) => (
              <div
                key={model}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '18px',
                  color: '#d0d0e0',
                  fontFamily: 'monospace',
                }}
              >
                {model}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '80px',
            fontSize: '18px',
            color: '#606070',
          }}
        >
          mpp.autonymlabs.org
        </div>
      </div>
    ),
    { ...size }
  )
}

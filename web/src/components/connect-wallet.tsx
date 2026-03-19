'use client'

import { useConnect, useConnectors, useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { Button } from '@/components/ui/button'
import { getNonce, verifySignature, setSessionToken, getSessionToken } from '@/lib/api'
import { useState, useEffect, useCallback } from 'react'

export function ConnectWallet({ onAuth }: { onAuth: (address: string) => void }) {
  const { connect, isPending, error: connectError } = useConnect()
  const [connector] = useConnectors()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authed, setAuthed] = useState(false)

  const doBackendAuth = useCallback(async (addr: string) => {
    setIsSigningIn(true)
    setAuthError(null)
    try {
      const { nonce, message } = await getNonce(addr)
      const signature = await signMessageAsync({ message })
      const { token } = await verifySignature(addr, signature, nonce)
      setSessionToken(token)
      setAuthed(true)
      onAuth(addr)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      setAuthError(msg)
      console.error('Sign-in failed:', err)
    } finally {
      setIsSigningIn(false)
    }
  }, [signMessageAsync, onAuth])

  // When wallet connects, auto-start backend auth
  useEffect(() => {
    if (isConnected && address && !authed) {
      // Check for existing session first
      if (getSessionToken()) {
        setAuthed(true)
        onAuth(address)
      } else {
        doBackendAuth(address)
      }
    }
  }, [isConnected, address, authed, onAuth, doBackendAuth])

  function handleSignOut() {
    setSessionToken(null)
    setAuthed(false)
    setAuthError(null)
    disconnect()
  }

  if (authed && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-muted-foreground">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign Out
        </Button>
      </div>
    )
  }

  if (isSigningIn) {
    return <Button disabled>Signing in...</Button>
  }

  if (isPending) {
    return <Button disabled>Connecting...</Button>
  }

  const error = authError || connectError?.message

  return (
    <div className="flex flex-col items-center gap-3">
      {error && (
        <p className="text-sm text-destructive max-w-md text-center">{error}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => connect({ connector, capabilities: { type: 'sign-up' } } as any)}>
          Sign Up with Passkey
        </Button>
        <Button variant="outline" onClick={() => connect({ connector })}>
          Sign In
        </Button>
      </div>
      {isConnected && address && (
        <Button variant="secondary" size="sm" onClick={() => doBackendAuth(address)}>
          Retry Authentication
        </Button>
      )}
    </div>
  )
}

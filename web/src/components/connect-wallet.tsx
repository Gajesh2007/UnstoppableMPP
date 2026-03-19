'use client'

import { useConnect, useConnectors, useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { Button } from '@/components/ui/button'
import { getNonce, verifySignature, setSessionToken, getSessionToken } from '@/lib/api'
import { useState, useEffect } from 'react'

export function ConnectWallet({ onAuth }: { onAuth: (address: string) => void }) {
  const { connect, isPending, error } = useConnect()
  const [connector] = useConnectors()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [authed, setAuthed] = useState(false)

  // Check for existing session on mount
  useEffect(() => {
    if (isConnected && address && getSessionToken()) {
      setAuthed(true)
      onAuth(address)
    }
  }, [isConnected, address, onAuth])

  async function handleSignIn() {
    if (!address) return
    setIsSigningIn(true)
    try {
      const { nonce, message } = await getNonce(address)
      const signature = await signMessageAsync({ message })
      const { token } = await verifySignature(address, signature, nonce)
      setSessionToken(token)
      setAuthed(true)
      onAuth(address)
    } catch (err) {
      console.error('Sign-in failed:', err)
    } finally {
      setIsSigningIn(false)
    }
  }

  function handleSignOut() {
    setSessionToken(null)
    setAuthed(false)
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

  if (isConnected && address) {
    return (
      <Button onClick={handleSignIn} disabled={isSigningIn}>
        {isSigningIn ? 'Signing...' : 'Sign In'}
      </Button>
    )
  }

  if (isPending) {
    return <Button disabled>Connecting...</Button>
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-destructive">{error.message}</p>
        <div className="flex gap-2">
          <Button onClick={() => connect({ connector, capabilities: { type: 'sign-up' } } as any)}>
            Sign Up
          </Button>
          <Button variant="outline" onClick={() => connect({ connector })}>
            Sign In
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button onClick={() => connect({ connector, capabilities: { type: 'sign-up' } } as any)}>
        Sign Up with Passkey
      </Button>
      <Button variant="outline" onClick={() => connect({ connector })}>
        Sign In
      </Button>
    </div>
  )
}

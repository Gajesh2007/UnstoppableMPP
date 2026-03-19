'use client'

import { useState, useEffect } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const DISCLAIMER_KEY = 'mpp_disclaimer_accepted'

export function DisclaimerModal({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState(true) // default true to avoid flash
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setAccepted(localStorage.getItem(DISCLAIMER_KEY) === 'true')
  }, [])

  function handleAccept() {
    localStorage.setItem(DISCLAIMER_KEY, 'true')
    setAccepted(true)
  }

  if (!mounted) return null

  if (accepted) return <>{children}</>

  return (
    <>
      <AlertDialog open={true}>
        <AlertDialogContent className="max-w-sm max-h-[70vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              Terms of Use & Disclaimer
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2 text-xs text-muted-foreground overflow-y-auto max-h-[50vh] pr-2">
                <p>
                  <strong className="text-foreground">This software is experimental and provided strictly for research purposes.</strong> By
                  proceeding, you acknowledge and agree to the following:
                </p>

                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    <strong className="text-foreground">Lawful Use Only.</strong> You will use this platform solely for lawful purposes and in
                    full compliance with all applicable laws, regulations, and third-party terms of service,
                    including but not limited to the terms of any API provider whose keys or credentials are
                    listed or used through this marketplace.
                  </li>
                  <li>
                    <strong className="text-foreground">Credential Sharing.</strong> If you list API keys, session tokens, or authentication
                    credentials on this platform, you do so voluntarily and at your own risk. You represent
                    that you have the right to share such credentials and accept full responsibility for any
                    consequences, including but not limited to account suspension, revocation, or termination
                    by the credential issuer. The platform does not encourage or endorse violation of any
                    third-party terms of service.
                  </li>
                  <li>
                    <strong className="text-foreground">No Warranty.</strong> This software is provided &quot;as is&quot; without warranty of any kind,
                    express or implied. The operators make no representations regarding the availability,
                    reliability, accuracy, or security of the platform or any credentials stored therein.
                  </li>
                  <li>
                    <strong className="text-foreground">Assumption of Risk.</strong> You assume all risk associated with your use of this platform,
                    including but not limited to financial loss, data loss, credential compromise, account
                    action by third-party providers, or service disruption.
                  </li>
                  <li>
                    <strong className="text-foreground">No Agency or Endorsement.</strong> This platform operates as neutral infrastructure. The
                    operators do not act as agents for any user, do not endorse any listed service or
                    credential, and have no control over how upstream providers enforce their terms.
                  </li>
                  <li>
                    <strong className="text-foreground">User Responsibility.</strong> You are solely responsible for your conduct on this platform.
                    Any misuse, unauthorized access, violation of third-party terms, or illegal activity is
                    your sole responsibility. The platform operators bear no liability for user actions or
                    for the actions of any third party.
                  </li>
                  <li>
                    <strong className="text-foreground">Limitation of Liability.</strong> To the maximum extent permitted by law, in no event shall
                    the platform operators be liable for any indirect, incidental, special, consequential, or
                    punitive damages, or any loss of profits or revenues, whether incurred directly or
                    indirectly, arising from your use of this platform.
                  </li>
                  <li>
                    <strong className="text-foreground">Indemnification.</strong> You agree to indemnify, defend, and hold harmless the platform
                    operators, contributors, and affiliates from any and all claims, damages, losses, costs,
                    or expenses (including reasonable legal fees) arising from your use or misuse of this
                    platform, your violation of these terms, or your violation of any third-party rights.
                  </li>
                  <li>
                    <strong className="text-foreground">No Guarantee of Service.</strong> Credentials listed on this platform may be revoked,
                    rate-limited, or become unavailable at any time without notice. The platform does not
                    guarantee uninterrupted access to any service and may discontinue operations at any time.
                  </li>
                  <li>
                    <strong className="text-foreground">Governing Law.</strong> These terms shall be governed by and construed in accordance with
                    the laws of the jurisdiction in which the platform operators are domiciled, without
                    regard to conflict of law principles.
                  </li>
                </ol>

                <p className="font-medium text-foreground pt-1">
                  By clicking &quot;I Accept&quot; below, you confirm that you have read, understood, and agree to
                  be bound by these terms.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleAccept}>
              I Accept
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

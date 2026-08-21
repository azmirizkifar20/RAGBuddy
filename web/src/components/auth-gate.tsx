import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getAuthStatus } from '@/lib/api-client'

interface AuthStatus {
  enabled: boolean
  authenticated: boolean
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    getAuthStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, authenticated: true }))
  }, [])

  if (!status) return <Skeleton className="h-svh w-full" />
  if (status.enabled && !status.authenticated) {
    // The login form lives at `/login`, outside the router's `/dashboard` basename, so this is a
    // hard navigation rather than a <Navigate>. The skeleton stays up until the browser leaves.
    window.location.replace('/login')
    return <Skeleton className="h-svh w-full" />
  }
  return <>{children}</>
}

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getAuthStatus } from '@/lib/api-client'
import { LoginScreen } from '@/components/login-screen'

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
    return <LoginScreen onSuccess={() => setStatus({ ...status, authenticated: true })} />
  }
  return <>{children}</>
}

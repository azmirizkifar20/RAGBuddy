import { useEffect, useState } from 'react'
import { ThemeProvider } from 'next-themes'
import { Skeleton } from '@/components/ui/skeleton'
import { getAuthStatus } from '@/lib/api-client'
import { LoginScreen } from '@/components/login-screen'

/** Standalone entry rendered at `/login` — outside the app router (the router's basename is
 *  `/dashboard`, so no in-router route can own this URL; see main.tsx for the mount switch).
 *  Redirects straight to the dashboard when there is nothing to log in for (gate disabled) or
 *  this browser already has a valid session. */
export function LoginEntry() {
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    getAuthStatus()
      .then((status) => {
        if (!status.enabled || status.authenticated) window.location.replace('/dashboard')
        else setShowForm(true)
      })
      .catch(() => window.location.replace('/dashboard'))
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {showForm ? (
        <LoginScreen onSuccess={() => window.location.replace('/dashboard')} />
      ) : (
        <Skeleton className="h-svh w-full" />
      )}
    </ThemeProvider>
  )
}

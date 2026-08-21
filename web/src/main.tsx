import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LoginEntry } from './components/login-entry'
import { installApiKeyHeader } from './lib/api-key'

installApiKeyHeader()

// URL layout: `/` is the static landing page (never reaches this bundle), `/login` is the
// standalone login entry, and the whole app lives under `/dashboard` (the router's basename).
// Anything else that still loads the SPA shell — pre-landing URLs like `/chat` or
// `/projects/<id>`, bookmarks, or unknown paths — gets moved under `/dashboard` with its tail
// intact, so old links keep working; the router's catch-all then handles whatever's left.
const path = window.location.pathname.replace(/\/+$/, '') || '/'
const isLoginPath = path === '/login'
const inDashboard = path === '/dashboard' || path.startsWith('/dashboard/')

if (!isLoginPath && !inDashboard) {
  const tail = path === '/' ? '' : path
  window.location.replace(`/dashboard${tail}${window.location.search}${window.location.hash}`)
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{isLoginPath ? <LoginEntry /> : <App />}</StrictMode>,
  )
}

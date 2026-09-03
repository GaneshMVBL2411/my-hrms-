import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SetupRequired } from './app/SetupRequired.tsx'
import { isSupabaseConfigured } from './lib/supabase.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? <App /> : <SetupRequired />}
  </StrictMode>,
)

// Registers the service worker that makes the app installable on a phone.
//
// Production only, and on purpose: in development it would serve a cached shell
// over Vite's freshly built one, so an edit appears not to have taken effect
// until the cache is cleared by hand. Registration is also deferred to `load`
// so it never competes with the first render for bandwidth.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unregistered worker costs offline launch and nothing else, so a
      // failure here must not take the app down with it.
    })
  })
}

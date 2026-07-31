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

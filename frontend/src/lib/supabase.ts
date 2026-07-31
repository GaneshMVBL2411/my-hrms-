import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

const REMEMBER_KEY = "hrms_remember_me"

/**
 * "Remember me" decides whether the session outlives the tab. Supabase always
 * writes to one storage, so route writes to the store the user picked at sign-in
 * while reading from both — otherwise a reload right after sign-in misses it.
 */
const hybridStorage: Storage = {
  getItem: (key) => sessionStorage.getItem(key) ?? localStorage.getItem(key),
  setItem: (key, value) => {
    const store = localStorage.getItem(REMEMBER_KEY) === "false" ? sessionStorage : localStorage
    store.setItem(key, value)
  },
  removeItem: (key) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
  clear: () => {},
  key: () => null,
  length: 0,
}

export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, String(remember))
}

// Missing config must not throw while this module is being imported: that takes
// the whole bundle down and the deployed site renders as a blank white page with
// nothing but a console error. main.tsx checks `isSupabaseConfigured` and shows
// setup instructions instead, so the client here only has to be constructible.
export const supabase = createClient(
  supabaseUrl || "https://unconfigured.supabase.co",
  supabaseAnonKey || "unconfigured",
  {
    auth: {
      storage: hybridStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
)

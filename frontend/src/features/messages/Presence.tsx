import { useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/features/auth/AuthContext"

/**
 * How often this tab says it is open.
 *
 * Matches the native app deliberately. Both beat well inside the server's
 * 75-second window, so an ordinary missed beat — a slow request, a moment of
 * throttling — does not flicker somebody offline and straight back on.
 */
const PRESENCE_INTERVAL_MS = 45_000

/**
 * Tells the server this person is here, for as long as the tab is in front.
 *
 * Mounted once above the routes rather than inside Messages, because presence
 * is about being reachable, not about looking at a conversation — someone
 * reading the dashboard is every bit as able to answer as someone with the
 * chat open.
 *
 * Without this, the web is invisible to it. The native app began reporting
 * presence first, and a colleague working all day in the portal would have
 * shown as permanently offline to every phone — which is a worse lie than the
 * hardcoded "online" this replaced, because it looks like real data.
 *
 * There is no counterpart that says "gone". The server stores the last time it
 * heard rather than a flag, so closing the tab is the entire mechanism, and a
 * crashed browser, a slept laptop and a closed lid all resolve the same
 * correct way without needing to run anything on the way out.
 */
export function Presence() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    let live = true
    const beat = () => {
      // A background tab is not somewhere a message is being read. Browsers
      // throttle timers there anyway, so beating would be unreliable as well
      // as untrue.
      if (!live || document.visibilityState !== "visible") return
      supabase.rpc("touch_presence").catch(() => undefined)
    }

    beat()
    const timer = window.setInterval(beat, PRESENCE_INTERVAL_MS)
    // Returning to the tab should say so at once, not up to 45 seconds later.
    document.addEventListener("visibilitychange", beat)

    return () => {
      live = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", beat)
    }
  }, [user])

  return null
}

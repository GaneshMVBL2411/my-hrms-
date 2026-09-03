import { useEffect } from "react"
import { useAuth } from "@/features/auth/AuthContext"

/**
 * Applies the signed-in tenant's brand colours.
 *
 * Every colour in the HRMS already resolves through CSS custom properties on
 * :root — `--primary` and friends, defined in index.css for both light and dark.
 * So theming a tenant is a matter of overriding those variables rather than
 * touching any component: the sidebar, buttons, badges, letterhead and payslip
 * band all follow automatically.
 *
 * Deliberately not a rewrite of the design system. A company gets its own
 * colour, not its own stylesheet — otherwise every new client would mean new UI
 * code, which is the thing multi-tenancy exists to avoid.
 */

/**
 * Picks readable text for a given background.
 *
 * A tenant can choose any colour, including a pale one, and white text on
 * #8CC63F is unreadable. This is the WCAG relative-luminance formula rather
 * than a simple average: the eye is far more sensitive to green than to blue,
 * and averaging the channels gets mid-tones wrong in exactly the range brand
 * colours tend to occupy.
 */
function readableForeground(hex: string): string {
  const clean = hex.replace("#", "")
  if (clean.length !== 6) return "#ffffff"

  const channel = (start: number) => {
    const v = parseInt(clean.slice(start, start + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }

  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  return luminance > 0.45 ? "#0b1220" : "#ffffff"
}

export function CompanyTheme() {
  const { user } = useAuth()

  useEffect(() => {
    const root = document.documentElement

    // Cleared on sign-out and when a company has no colours of its own, so the
    // platform palette from index.css takes over again. Without this, one
    // tenant's colours would persist into the next session in the same tab.
    const clear = () => {
      root.style.removeProperty("--primary")
      root.style.removeProperty("--primary-foreground")
      root.style.removeProperty("--accent")
      root.style.removeProperty("--ring")
    }

    if (!user?.primaryColor) {
      clear()
      return
    }

    root.style.setProperty("--primary", user.primaryColor)
    root.style.setProperty("--primary-foreground", readableForeground(user.primaryColor))
    root.style.setProperty("--ring", user.primaryColor)
    if (user.accentColor) root.style.setProperty("--accent", user.accentColor)

    return clear
  }, [user?.primaryColor, user?.accentColor])

  return null
}

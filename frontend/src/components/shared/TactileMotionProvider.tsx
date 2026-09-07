import { useEffect, type ReactNode } from "react"

/**
 * Global Tactile Motion Controller:
 * Ensures every icon clicked anywhere in the app plays out its full, lifelike
 * physical micro-interaction without premature cut-off on fast clicks or mobile taps.
 */
export function TactileMotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handleInteraction = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      // Check if target is an SVG, inside an SVG, or an interactive element containing an SVG
      const svg =
        target.closest("svg") ??
        target.closest("button, a, [role='button'], .interactive-click")?.querySelector("svg")

      if (!svg) return

      // If already animating, remove class first so the animation resets and replays cleanly
      svg.classList.remove("tactile-animating")
      // Force DOM reflow to allow immediate re-trigger
      void svg.clientWidth

      svg.classList.add("tactile-animating")

      // Clean up after the realistic animation duration (650ms)
      setTimeout(() => {
        svg.classList.remove("tactile-animating")
      }, 650)
    }

    document.addEventListener("pointerdown", handleInteraction, { passive: true })
    return () => {
      document.removeEventListener("pointerdown", handleInteraction)
    }
  }, [])

  return <>{children}</>
}

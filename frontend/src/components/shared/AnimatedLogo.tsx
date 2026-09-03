import { useState } from "react"
import logoMark from "@/assets/logo-mark.png"
import { cn } from "@/lib/utils"

/**
 * The brand mark, moving the way a hung object moves — the same drop, float and
 * sway the phone app's login screen uses, so the two front doors match — with a
 * light running a W around it and tactile spring bounce on click.
 *
 * Three nested elements for the motion rather than one, because all three are
 * transforms and CSS cannot compose transforms across animations on a single
 * element: the last one declared simply wins and the other two vanish. One
 * animation per element is the fix.
 *
 *   outer  drops in and settles
 *   middle floats up and down
 *   img    sways a degree or so either way
 *
 * The float and sway run on mismatched periods (2.6s against 4.1s) so they
 * drift in and out of phase instead of pulsing together, which is the
 * difference between something hanging and something blinking.
 *
 * Keyframes live in index.css inside the reduced-motion guard, so a visitor who
 * has asked for less movement gets the mark sitting still — and, because the
 * entrance sets opacity, gets it fully visible rather than faded out.
 */
export function AnimatedLogo({ className }: { className?: string }) {
  const [bounced, setBounced] = useState(false)

  const triggerBounce = () => {
    setBounced(true)
    setTimeout(() => setBounced(false), 650)
  }

  return (
    <span
      onClick={triggerBounce}
      role="button"
      tabIndex={0}
      aria-label="Brand Logo"
      className={cn(
        "logo-hang-drop inline-block cursor-pointer select-none transition-transform active:scale-90",
        bounced && "logo-spring-active"
      )}
    >
      <span className="logo-hang-float inline-block">
        <span className="relative inline-block">
          {/*
            The light, and the path it runs. Two strokes of the same W: a faint
            one always visible, and a short bright dash travelling along it.
            Without the faint track the bright dash reads as a stray streak;
            with it, it reads as light moving down something.

            pathLength="100" restates the path as 100 units long whatever its
            real geometry, so the dash and the offset below are percentages and
            stay correct if the shape is ever redrawn.

            Sits behind the mark and overflows its box on purpose — the W is
            drawn wider than the logo so the light passes outside it.
          */}
          <svg
            className="logo-trace pointer-events-none absolute"
            viewBox="0 0 100 100"
            fill="none"
            aria-hidden="true"
          >
            <path className="logo-trace-track" pathLength={100} d="M6 26 L28 80 L50 40 L72 80 L94 26" />
            <path className="logo-trace-light" pathLength={100} d="M6 26 L28 80 L50 40 L72 80 L94 26" />
          </svg>
          <img src={logoMark} alt="" className={cn("logo-hang-sway relative object-contain", className)} />
        </span>
      </span>
    </span>
  )
}

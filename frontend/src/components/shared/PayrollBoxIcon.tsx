import type { CSSProperties } from "react"
import { Icon3D, Extrude } from "@/components/shared/nav-icons-3d"

/**
 * The Payroll icon: a money box with a hinged lid and a stack of banknotes.
 * When the parent <svg> carries `nav-anim-paybox` (added on click), the lid
 * flips open and the notes rise and fan out of the box one after another, then
 * drop back and the lid closes. Keyframes: index.css.
 *
 * Two different animation techniques meet here, and they need opposite
 * treatment to survive the 3D rebuild:
 *
 *   the notes  animate the SVG `x`/`y` attributes, which only a <rect> has — so
 *              each note's shadow is a second rect carrying the same note- class
 *              and its own translate, moving in step with the note it sits under
 *   the lid    animates a 2D rotate, which a <g> takes perfectly well — so the
 *              lid's three faces are wrapped in one <g class="paylid"> and turn
 *              together as a single solid object
 */
export function PayrollBoxIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <Icon3D className={className} style={style}>
      {/* banknotes — drawn first so the box frames them; each is a shadow and a
          face, stacked back to front so note-1 ends up on top */}
      <rect className="f-side paynote note-3" transform="translate(1.4 1.4)" x="7" y="12" width="10" height="6" rx="1.2" />
      <rect className="f-top  paynote note-3" x="7" y="12" width="10" height="6" rx="1.2" />
      <rect className="f-side paynote note-2" transform="translate(1.4 1.4)" x="7" y="12" width="10" height="6" rx="1.2" />
      <rect className="f-top  paynote note-2" x="7" y="12" width="10" height="6" rx="1.2" />
      <rect className="f-side paynote note-1" transform="translate(1.4 1.4)" x="7" y="12" width="10" height="6" rx="1.2" />
      <rect className="f-top  paynote note-1" x="7" y="12" width="10" height="6" rx="1.2" />

      {/* box body */}
      <Extrude>
        <rect x="2.6" y="9" width="18" height="10.6" rx="2.2" />
      </Extrude>
      <rect className="f-hi" x="5" y="11.4" width="3.6" height="1.5" rx="0.75" />
      <circle className="f-deep" cx="16.8" cy="14.4" r="1.3" />

      {/* lid — one solid that turns on its left hinge. Lit by hand rather than
          through <Extrude> so all four layers stay inside the one <g> that
          rotates; split across two groups, the lid would come apart mid-turn. */}
      <g className="paylid">
        <rect className="f-side" transform="translate(1.4 1.4)" x="2.6" y="5.6" width="18" height="3.4" rx="1.7" />
        <rect className="f-mid" x="2.6" y="5.6" width="18" height="3.4" rx="1.7" />
        <rect fill="url(#i3d-shade)" x="2.6" y="5.6" width="18" height="3.4" rx="1.7" />
        <rect fill="url(#i3d-sheen)" x="2.6" y="5.6" width="18" height="3.4" rx="1.7" />
      </g>
    </Icon3D>
  )
}

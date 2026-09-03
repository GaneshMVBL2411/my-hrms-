import type { CSSProperties } from "react"
import { Icon3D } from "@/components/shared/nav-icons-3d"

/**
 * The Dashboard icon: four solid tiles standing off the surface. When the parent
 * <svg> carries `nav-anim-orbit` (added on click), the four travel clockwise
 * around the grid — right, down, left, up — holding formation the whole way,
 * then settle back home. The per-square keyframes (dbd-a … dbd-d) are in
 * index.css.
 *
 * Each tile is three elements, not one: the shadow beneath it, the front face,
 * and the lit top face. All three carry the same dbd- class, because those
 * keyframes animate the SVG `x`/`y` attributes rather than a transform — a
 * wrapping <g> has no x/y for them to move, so the class has to sit on every
 * rect. The shadow keeps its offset through the orbit by carrying a translate of
 * its own, which the animation leaves alone.
 */
export function DashboardOrbitIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <Icon3D className={className} style={style}>
      {/* extruded sides — all four first, so no tile's shadow lands on a neighbour */}
      <rect className="f-side dbd dbd-tl" transform="translate(1.3 1.3)" x="4" y="4" width="7" height="7" rx="1.8" />
      <rect className="f-side dbd dbd-tr" transform="translate(1.3 1.3)" x="13" y="4" width="7" height="7" rx="1.8" />
      <rect className="f-side dbd dbd-br" transform="translate(1.3 1.3)" x="13" y="13" width="7" height="7" rx="1.8" />
      <rect className="f-side dbd dbd-bl" transform="translate(1.3 1.3)" x="4" y="13" width="7" height="7" rx="1.8" />
      {/* front faces */}
      <rect className="f-mid dbd dbd-tl" x="4" y="4" width="7" height="7" rx="1.8" />
      <rect className="f-mid dbd dbd-tr" x="13" y="4" width="7" height="7" rx="1.8" />
      <rect className="f-mid dbd dbd-br" x="13" y="13" width="7" height="7" rx="1.8" />
      <rect className="f-mid dbd dbd-bl" x="4" y="13" width="7" height="7" rx="1.8" />
      {/* form shadow, then the light — the same two layers <Extrude> lays over
          every other icon, spelled out here because these tiles cannot use it */}
      <rect fill="url(#i3d-shade)" className="dbd dbd-tl" x="4" y="4" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-shade)" className="dbd dbd-tr" x="13" y="4" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-shade)" className="dbd dbd-br" x="13" y="13" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-shade)" className="dbd dbd-bl" x="4" y="13" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-sheen)" className="dbd dbd-tl" x="4" y="4" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-sheen)" className="dbd dbd-tr" x="13" y="4" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-sheen)" className="dbd dbd-br" x="13" y="13" width="7" height="7" rx="1.8" />
      <rect fill="url(#i3d-sheen)" className="dbd dbd-bl" x="4" y="13" width="7" height="7" rx="1.8" />
    </Icon3D>
  )
}

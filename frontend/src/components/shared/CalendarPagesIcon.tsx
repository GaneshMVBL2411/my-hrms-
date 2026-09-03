import type { CSSProperties } from "react"
import { Icon3D, Extrude } from "@/components/shared/nav-icons-3d"

/**
 * The Calendar icon: a solid block with a dark header, two binding rings, and a
 * stack of page sheets sunk into its face. When the parent <svg> carries
 * `nav-anim-calpages` (added on click), the pages flip over the top binding one
 * after another — like riffling through a wall calendar — then settle back flat.
 * Keyframes: index.css.
 *
 * The sheets are three rects stacked at the same spot; the last one paints on
 * top and flips first, revealing the one beneath, and so on. They alternate
 * between the two light tones, which is what makes the riffle visible: a flip
 * that uncovered an identically-coloured sheet would look like nothing moved.
 *
 * The cal-page keyframes drive a 2D scaleY and touch no coordinates, so unlike
 * the Dashboard and Payroll icons the sheets were free to be repositioned for
 * the thicker frame.
 */
export function CalendarPagesIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <Icon3D className={className} style={style}>
      <Extrude>
        {/* binding rings, then the block itself */}
        <rect x="7" y="1.6" width="2.6" height="4.4" rx="1.3" />
        <rect x="14" y="1.6" width="2.6" height="4.4" rx="1.3" />
        <rect x="2.6" y="4" width="18" height="16.8" rx="2.4" />
      </Extrude>

      {/* header band, darkest so the sheets below read as paper */}
      <path className="f-deep" d="M2.6 6.4A2.4 2.4 0 0 1 5 4h13.2a2.4 2.4 0 0 1 2.4 2.4v2.4H2.6z" />

      {/* page sheets — last in DOM paints on top and flips first */}
      <rect className="f-top calpage cal-p3" x="4.4" y="10" width="14.4" height="8.4" rx="1.2" />
      <rect className="f-hi  calpage cal-p2" x="4.4" y="10" width="14.4" height="8.4" rx="1.2" />
      <rect className="f-top calpage cal-p1" x="4.4" y="10" width="14.4" height="8.4" rx="1.2" />
    </Icon3D>
  )
}

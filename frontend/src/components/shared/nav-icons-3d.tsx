import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The sidebar's nav icons, drawn as solid 3D objects rather than line art.
 *
 * Each one is built the same way, which is what makes fifteen unrelated objects
 * — a clock, a folder, a megaphone — look like one set:
 *
 *   1. a silhouette, which <Extrude> paints four times: the extruded flank, the
 *      body colour, a form shadow rolling off to the lower right, and the light
 *      striking the upper left. All four are the same shape, so the modelling
 *      fits the object exactly and no icon draws its own shading
 *   2. flat lighter faces over that for surfaces at a different angle — a clock
 *      face, a folded corner, a page
 *   3. the darkest tone only for holes and openings — a gear's hub, a clock's
 *      hands — so depth reads as depth and not as a second colour
 *
 * Every tone is mixed from currentColor (see the `.i3d` rules in index.css), and
 * the sidebar sets currentColor per row from nav-config.ts. So each item still
 * has exactly one colour to its name; the shading follows from it.
 *
 * These are drawn at 18px. That size is the reason they are chunky solids with
 * two or three faces instead of finely modelled ones — thin bevels and gradient
 * stacks turn to mud below about 32px, where a bold silhouette still reads.
 *
 * ---------------------------------------------------------------------------
 * Motion
 *
 * Clicking a row animates the object, and what moves is the part that would
 * move on the real thing: a clock's hands sweep while its case stays still, a
 * laptop's lid opens while its base stays on the desk, ticks land in a checklist
 * one row at a time. The classes below (`clk-hour`, `ast-lid`, `tsk-1`…) are the
 * handles the keyframes in index.css hold on to; a part with no class is a part
 * that does not move.
 *
 * Two rules govern how those handles are placed, both learned the hard way:
 *
 *   * A class on a child of <Extrude> lands on all four painted copies, so the
 *     flank and the shading travel with the face and the part moves as one
 *     solid. That is why moving parts are wrapped in a <g> inside <Extrude>
 *     rather than highlighted afterwards.
 *   * A part whose pivot is not its own centre — a clock hand turning about the
 *     dial, a lid hinging on the base — needs `transform-box: view-box` and an
 *     origin in viewBox units. Left on the default, every piece would swing
 *     about its own middle and the object would come apart.
 *
 * Chrome does not render 3D transforms on SVG children, so every one of these
 * is 2D: rotate, scale, translate, or an animated x/y. A lid "opening" is a
 * scaleY collapse toward its hinge, which at this size reads exactly the same.
 *
 * The three icons with moving parts of their own (Dashboard, Payroll, Calendar)
 * keep their own files, next to the class names their keyframes target.
 */

/**
 * The <svg> every icon shares, carrying the light with it: `i3d` resolves the
 * tone classes, and the two gradients below are the light and the shadow.
 *
 * Both are pure white and pure black — no colour of their own — which is what
 * lets one pair of definitions light fifteen differently-coloured objects. It is
 * also why the duplicate ids are harmless: every icon on the page defines these
 * identically, so a browser resolving all of them to the first one gets the same
 * gradient either way. (A gradient built from currentColor could not do that —
 * every icon would inherit the first icon's colour.)
 *
 * They are in user space rather than each shape's own box, so the light falls
 * across the whole object from one direction instead of relighting every part
 * separately — six columns of a bank front are lit as one building.
 */
export function Icon3D({
  className,
  style,
  children,
}: {
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("i3d", className)}
      style={style}
      aria-hidden="true"
    >
      <defs>
        {/* the light, striking the upper left */}
        <linearGradient id="i3d-sheen" gradientUnits="userSpaceOnUse" x1="3" y1="1" x2="17" y2="21">
          <stop offset="0" stopColor="#fff" stopOpacity="0.62" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {/* the form shadow rolling away from it */}
        <linearGradient id="i3d-shade" gradientUnits="userSpaceOnUse" x1="4" y1="2" x2="20" y2="22">
          <stop offset="0.35" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  )
}

/**
 * Paints its children four times to turn a flat silhouette into a lit solid:
 * the extruded flank offset down-right, the body colour, the form shadow, then
 * the light. Because all four are the same shape, the shading follows the
 * object's outline exactly — no per-icon highlight geometry to draw or keep in
 * step, and every icon in the set is lit from the same direction for free.
 *
 * Children must be bare silhouette shapes carrying no fill of their own — they
 * inherit it from whichever copy they are in, and a child that set its own fill
 * would light up inside the flank and punch through the shading. Put highlights
 * after <Extrude>, not inside it.
 *
 * A className on a child is the exception, and the reason moving parts are
 * wrapped in a <g> here: it lands on all four copies, so the part animates as
 * one solid instead of the face sliding off its own shadow.
 */
export function Extrude({ children }: { children: ReactNode }) {
  return (
    <>
      <g className="f-side" transform="translate(1.4 1.4)">
        {children}
      </g>
      <g className="f-mid">{children}</g>
      <g fill="url(#i3d-shade)">{children}</g>
      <g fill="url(#i3d-sheen)">{children}</g>
    </>
  )
}

// ---------------------------------------------------------------- Employees
/** Two figures. On click they bob in turn, the way a queue shuffles forward. */
export function EmployeesIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <g className="emp-back">
        <circle cx="16.4" cy="9.4" r="2.5" />
        <path d="M12.6 19.4a4.3 4.3 0 0 1 8.6 0z" />
      </g>
      <g className="emp-front">
        <circle cx="8.6" cy="8.2" r="3.4" />
        <path d="M2.2 19.4a6.4 6.4 0 0 1 12.8 0z" />
      </g>
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <g className="emp-front">
        <circle className="f-hi" cx="7.4" cy="7" r="1.1" />
        <path className="f-top" d="M3.4 16.2a6.3 6.3 0 0 1 4.6-2.7v5.9H2.4a6.3 6.3 0 0 1 1-3.2z" />
      </g>
    </Icon3D>
  )
}

// --------------------------------------------------------------- Attendance
/**
 * A clock. The case stays put and the hands sweep — the minute hand a full
 * turn, the hour hand the one hour that buys, which is the whole point of
 * splitting what used to be a single polyline into two.
 */
export function AttendanceIcon(props: { className?: string; style?: CSSProperties }) {
  return (
    <Icon3D {...props}>
      <Extrude>
        <circle cx="11.2" cy="11.4" r="9" />
      </Extrude>
      <circle className="f-top" cx="11.2" cy="11.4" r="6.6" />
      <path className="f-hi" d="M11.2 4.8a6.6 6.6 0 0 0-6.6 6.6 6.6 6.6 0 0 1 11.3-4.7 6.6 6.6 0 0 0-4.7-1.9z" />
      <path className="s-deep clk-hour" strokeWidth="2" d="M11.2 11.4V7.6" />
      <path className="s-deep clk-min" strokeWidth="1.6" d="M11.2 11.4l3.2 1.9" />
      <circle className="f-deep" cx="11.2" cy="11.4" r="1" />
    </Icon3D>
  )
}

// ------------------------------------------------------------------- Leaves
/**
 * A parasol, which on click springs open over a handle that stays put.
 *
 * It replaced a date block with a clock badge overlapping it. Two objects that
 * size, one round and one square and touching, resolved into a single blob —
 * whatever the shapes were doing at 24 units, at 18 pixels it read as a
 * briefcase. A parasol has one silhouette, needs no second object to say
 * "time off", and cannot be confused with the Calendar two rows below or the
 * Attendance clock two rows above, which the old one could be mistaken for
 * either of.
 */
export function LeavesIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      {/* handle: straight down the pole, then the hook curls back up */}
      <path d="M10.6 9h1.8v8.6a1.6 1.6 0 0 0 3.2 0h1.8a3.4 3.4 0 0 1-6.8 0z" />
      {/* canopy: a half-dome closed off by four scallops along the hem */}
      <path
        className="lv-canopy"
        d="M2.6 11.2A8.9 8.9 0 0 1 20.4 11.2q-2.225 2.4-4.45 0-2.225 2.4-4.45 0-2.225 2.4-4.45 0-2.225 2.4-4.45 0z"
      />
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      {/* the lit half of the canopy, stopping at the hem so the scallops show */}
      <path className="f-top lv-canopy" d="M11.5 2.3v8.9H2.6a8.9 8.9 0 0 1 8.9-8.9z" />
    </Icon3D>
  )
}

// ----------------------------------------------------------------- Projects
/** A folder holding a board. The three columns rise in turn, the way cards get
 *  dealt onto a board — the folder itself stays where it is. */
export function ProjectsIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <path d="M2.6 5.4a2 2 0 0 1 2-2h4.2l2.4 2.8H2.6z" />
      <rect x="2.6" y="5.4" width="17" height="13.4" rx="2.2" />
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <path className="f-top" d="M2.6 9h17v7.6a2.2 2.2 0 0 1-2.2 2.2H4.8a2.2 2.2 0 0 1-2.2-2.2z" />
      <rect className="f-deep prj-1" x="5.4" y="11" width="2.6" height="5.4" rx="1.3" />
      <rect className="f-deep prj-2" x="9.8" y="11" width="2.6" height="3.2" rx="1.3" />
      <rect className="f-deep prj-3" x="14.2" y="11" width="2.6" height="4.4" rx="1.3" />
    </Icon3D>
  )
}

// -------------------------------------------------------------------- Tasks
/**
 * A clipboard. The three ticks draw themselves on, top row first — the one
 * motion here that is worth the extra geometry, since a checklist filling in is
 * what a checklist actually does.
 */
export function TasksIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <rect x="3" y="3.4" width="15.2" height="16" rx="2.4" />
      <rect x="7.2" y="1.4" width="6.8" height="3.8" rx="1.5" />
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <rect className="f-hi" x="5.6" y="8" width="2.4" height="2.4" rx="0.7" />
      <rect className="f-top" x="9" y="8.4" width="6.2" height="1.7" rx="0.85" />
      <rect className="f-hi" x="5.6" y="11.9" width="2.4" height="2.4" rx="0.7" />
      <rect className="f-top" x="9" y="12.3" width="6.2" height="1.7" rx="0.85" />
      <rect className="f-hi" x="5.6" y="15.8" width="2.4" height="2.4" rx="0.7" />
      <rect className="f-top" x="9" y="16.2" width="6.2" height="1.7" rx="0.85" />
      <path className="s-deep tsk-1" strokeWidth="1.3" strokeLinejoin="round" d="m6.2 9.2.9.9 1.4-1.7" />
      <path className="s-deep tsk-2" strokeWidth="1.3" strokeLinejoin="round" d="m6.2 13.1.9.9 1.4-1.7" />
      <path className="s-deep tsk-3" strokeWidth="1.3" strokeLinejoin="round" d="m6.2 17 .9.9 1.4-1.7" />
    </Icon3D>
  )
}

// ----------------------------------------------------- Company Bank Details
/** A bank front. The pediment and its entablature drop onto the columns and
 *  rebound — a stamp coming down on the paperwork. The plinth never moves. */
export function BankIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <g className="bnk-top">
        <path d="M11.4 1.8 20.6 6.6H2.2z" />
        <rect x="2.8" y="6.6" width="17.2" height="2.4" rx="1" />
      </g>
      <rect x="4.4" y="9" width="2.5" height="7.6" rx="0.6" />
      <rect x="10.15" y="9" width="2.5" height="7.6" rx="0.6" />
      <rect x="15.9" y="9" width="2.5" height="7.6" rx="0.6" />
      <rect x="2.2" y="16.6" width="18.4" height="3" rx="1.3" />
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <path className="f-top bnk-top" d="M11.4 1.8 20.6 6.6h-3.9L11.4 3.8z" />
      <rect className="f-hi" x="4.9" y="9.4" width="0.9" height="6.8" rx="0.45" />
      <rect className="f-hi" x="10.65" y="9.4" width="0.9" height="6.8" rx="0.45" />
      <rect className="f-hi" x="16.4" y="9.4" width="0.9" height="6.8" rx="0.45" />
      <rect className="f-top" x="2.2" y="16.6" width="18.4" height="1.2" rx="0.6" />
    </Icon3D>
  )
}

// ------------------------------------------------------------------- Assets
/** A laptop. The lid hinges open off the base and settles back; the base stays
 *  flat on the desk, which is the difference between a laptop opening and a
 *  laptop being tipped over. */
export function AssetsIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <g className="ast-lid">
        <rect x="3.8" y="3" width="15.4" height="10.6" rx="1.8" />
      </g>
      <rect x="1.8" y="15.6" width="19" height="3.2" rx="1.6" />
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <g className="ast-lid">
        <rect className="f-top" x="5.4" y="4.6" width="12.2" height="7.4" rx="1" />
        <path className="f-hi" d="M5.4 5.6a1 1 0 0 1 1-1h4.8L6.2 12h-.8z" />
      </g>
      <rect className="f-hi" x="9" y="16.7" width="4.6" height="1" rx="0.5" />
    </Icon3D>
  )
}

// -------------------------------------------------------------- Recruitment
/** A figure with a plus beside it. The plus springs in and the figure gives a
 *  nod — someone being taken on. */
export function RecruitmentIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <g className="rec-person">
        <circle cx="8.6" cy="8" r="3.4" />
        <path d="M2.2 19.4a6.4 6.4 0 0 1 12.8 0z" />
      </g>
      <g className="rec-plus">
        <rect x="16.3" y="7.4" width="2.6" height="7.8" rx="1.3" />
        <rect x="13.7" y="10" width="7.8" height="2.6" rx="1.3" />
      </g>
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <circle className="f-hi rec-person" cx="7.4" cy="6.8" r="1.1" />
      <g className="rec-plus">
        <rect className="f-top" x="16.8" y="7.9" width="1.2" height="6.8" rx="0.6" />
        <rect className="f-top" x="14.2" y="10.5" width="6.8" height="1.2" rx="0.6" />
      </g>
    </Icon3D>
  )
}

// ---------------------------------------------------------------- Documents
/** A sheet with a folded corner. The fold lifts and lies back down, and the
 *  lines of text wipe in beneath it, left to right, as if being written. */
export function DocumentsIcon(props: { className?: string; style?: CSSProperties }) {
  return (
    <Icon3D {...props}>
      <Extrude>
        <path d="M5 4.2A2.2 2.2 0 0 1 7.2 2h6l5.6 5.6v11a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 18.6z" />
      </Extrude>
      <path className="f-top doc-fold" d="M13.2 2l5.6 5.6h-3.4a2.2 2.2 0 0 1-2.2-2.2z" />
      <rect className="f-hi doc-l1" x="7.8" y="11" width="8.2" height="1.5" rx="0.75" />
      <rect className="f-hi doc-l2" x="7.8" y="14.2" width="8.2" height="1.5" rx="0.75" />
      <rect className="f-hi doc-l3" x="7.8" y="17.4" width="5" height="1.5" rx="0.75" />
    </Icon3D>
  )
}

// ------------------------------------------------------------ Announcements
/** A megaphone. It kicks back against the shout while two rings leave the
 *  mouth and fade — the recoil is what sells it as loud. */
export function AnnouncementsIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <g className="ann-horn">
      <rect x="5.4" y="12.6" width="3" height="6.8" rx="1.5" />
      <path d="M2.6 9.4 16.4 4.6V18L2.6 13.8z" />
      <rect x="16" y="3.4" width="3.6" height="16" rx="1.8" />
    </g>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <g className="ann-horn">
        <path className="f-top" d="M2.6 9.4 16.4 4.6v2.6L2.6 11.5z" />
        <rect className="f-hi" x="16.6" y="5" width="1.3" height="12.8" rx="0.65" />
      </g>
      <path className="s-deep ann-ring-1" strokeWidth="1.5" d="M20.6 9.2a4 4 0 0 1 0 4.6" />
      <path className="s-deep ann-ring-2" strokeWidth="1.5" d="M22.4 7.6a7 7 0 0 1 0 7.8" />
    </Icon3D>
  )
}

// ----------------------------------------------------------------- Messages
/**
 * Two speech bubbles, one behind the other — HR's and the employee's.
 *
 * The pair is the point: a single bubble is a notice, two overlapping ones are
 * a conversation, which is what this screen is for. The back bubble is drawn
 * first so the front one occludes it and the two read as depth rather than as
 * one odd shape.
 *
 * On click they answer each other: the back bubble rises and settles, then the
 * front one replies a beat later — the rhythm of a reply, not two things
 * bouncing at once.
 */
export function MessagesIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <g className="msg-back">
        {/* Tail at the top left: this bubble is the one being answered. */}
        <path d="M4.2 3.2h11.6a2.4 2.4 0 0 1 2.4 2.4v5.2a2.4 2.4 0 0 1-2.4 2.4H9.4l-3.6 2.7.5-2.7H4.2a2.4 2.4 0 0 1-2.4-2.4V5.6A2.4 2.4 0 0 1 4.2 3.2z" />
      </g>
      <g className="msg-front">
        <path d="M10.6 9.4h9.2a2.4 2.4 0 0 1 2.4 2.4v4.6a2.4 2.4 0 0 1-2.4 2.4h-1.5l.5 2.6-3.5-2.6h-4.7a2.4 2.4 0 0 1-2.4-2.4v-4.6a2.4 2.4 0 0 1 2.4-2.4z" />
      </g>
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      {/* Lines of text, only on the front bubble — the one facing the reader. */}
      <g className="msg-front">
        <rect className="f-hi" x="11.4" y="12.4" width="8.6" height="1.3" rx="0.65" />
        <rect className="f-hi" x="11.4" y="15" width="5.4" height="1.3" rx="0.65" />
      </g>
    </Icon3D>
  )
}

// ------------------------------------------------------------------ Reports
/** Three bars. They grow out of the floor shortest-first, each overshooting
 *  its height and settling — a chart drawing itself. */
export function ReportsIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <g className="rpt-1">
        <rect x="3.4" y="12.2" width="4.6" height="7.6" rx="1.5" />
      </g>
      <g className="rpt-2">
        <rect x="9.6" y="8.2" width="4.6" height="11.6" rx="1.5" />
      </g>
      <g className="rpt-3">
        <rect x="15.8" y="4.2" width="4.6" height="15.6" rx="1.5" />
      </g>
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
    </Icon3D>
  )
}

// ----------------------------------------------------------------- Settings
/**
 * A gear. Eight teeth from four bars crossed at 45°, which is both fewer nodes
 * than a traced gear outline and exactly symmetrical — it has to stay clean
 * through a full turn, since clicking Settings spins it.
 *
 * The one icon that still turns as a whole, because that is what a gear does.
 */
export function SettingsIcon(props: { className?: string; style?: CSSProperties }) {
  const body = (
    <>
      <circle cx="11.3" cy="11.3" r="6.8" />
      <rect x="9.5" y="2.1" width="3.6" height="18.4" rx="1.8" />
      <rect x="9.5" y="2.1" width="3.6" height="18.4" rx="1.8" transform="rotate(45 11.3 11.3)" />
      <rect x="9.5" y="2.1" width="3.6" height="18.4" rx="1.8" transform="rotate(90 11.3 11.3)" />
      <rect x="9.5" y="2.1" width="3.6" height="18.4" rx="1.8" transform="rotate(135 11.3 11.3)" />
    </>
  )
  return (
    <Icon3D {...props}>
      <Extrude>{body}</Extrude>
      <circle className="f-top" cx="11.3" cy="11.3" r="4.9" />
      <circle className="f-deep" cx="11.3" cy="11.3" r="2.9" />
    </Icon3D>
  )
}

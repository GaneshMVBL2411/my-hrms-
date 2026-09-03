import type { ComponentType, CSSProperties } from "react"
import {
  EmployeesIcon,
  AttendanceIcon,
  LeavesIcon,
  ProjectsIcon,
  TasksIcon,
  BankIcon,
  AssetsIcon,
  RecruitmentIcon,
  DocumentsIcon,
  AnnouncementsIcon,
  MessagesIcon,
  ReportsIcon,
  SettingsIcon,
} from "@/components/shared/nav-icons-3d"
import { DashboardOrbitIcon } from "@/components/shared/DashboardOrbitIcon"
import { CalendarPagesIcon } from "@/components/shared/CalendarPagesIcon"
import { PayrollBoxIcon } from "@/components/shared/PayrollBoxIcon"
import type { Role } from "@/features/auth/types"

/** The click animation each icon plays; keyframes live in index.css. */
export type NavAnim =
  // One per icon, and each is that object's own movement rather than a generic
  // transform — so they are not interchangeable: "sweep" turns a clock's hands
  // and finds nothing to turn on a folder. Listing only the fifteen that exist
  // means picking a motion an icon has no parts for is a compile error.
  | "orbit"    // Dashboard      tiles walk the grid
  | "walk"     // Employees      the pair bob in turn
  | "sweep"    // Attendance     the hands go round
  | "daysoff"  // Leaves         the block rocks, the clock runs on
  | "board"    // Projects       cards dealt onto the board
  | "ticks"    // Tasks          the ticks draw themselves on
  | "paybox"   // Payroll        lid opens, notes rise
  | "stamp"    // Company Bank   the pediment drops onto the columns
  | "lid"      // Assets         the laptop lid hinges open
  | "join"     // Recruitment    the plus springs in, the figure nods
  | "pageturn" // Documents      the corner lifts, the text writes in
  | "calpages" // Calendar       the sheets riffle
  | "shout"    // Announcements  the horn recoils, rings leave the mouth
  | "reply"    // Messages       one bubble speaks, the other answers
  | "bars"     // Reports        the bars grow out of the floor
  | "spin"     // Settings       the gear turns

/** Any icon that renders an <svg> taking a className and style. Every nav icon
 *  is now one of our own 3D ones — see components/shared/nav-icons-3d.tsx. */
type NavIcon = ComponentType<{ className?: string; style?: CSSProperties }>

export interface NavItem {
  label: string
  path: string
  icon: NavIcon
  implemented: boolean
  roles?: Role[]
  /** The icon's own colour, shown always and intensified on the active row. */
  color: string
  /** The motion the icon plays when its row is clicked, matched to the icon. */
  anim: NavAnim
}

export const navItems: NavItem[] = [
  // Each icon plays a motion that mimics the real thing it stands for.
  { label: "Dashboard", path: "/dashboard", icon: DashboardOrbitIcon, implemented: true, color: "#5A9AA8", anim: "orbit" },   // four squares orbit the grid
  { label: "Employees", path: "/employees", icon: EmployeesIcon, implemented: true, color: "#818cf8", anim: "walk" },              // the pair bob in turn
  { label: "Attendance", path: "/attendance", icon: AttendanceIcon, implemented: true, color: "#38bdf8", anim: "sweep" },             // the hands sweep, the case stays put
  { label: "Leaves", path: "/leaves", icon: LeavesIcon, implemented: true, color: "#fbbf24", anim: "daysoff" },            // the block rocks, the clock runs on
  { label: "Projects", path: "/projects", icon: ProjectsIcon, implemented: true, color: "#a78bfa", anim: "board" },          // cards dealt onto the board
  { label: "Tasks", path: "/tasks", icon: TasksIcon, implemented: true, color: "#34d399", anim: "ticks" },                 // the ticks draw themselves on
  { label: "Payroll", path: "/payroll", icon: PayrollBoxIcon, implemented: true, color: "#22c55e", anim: "paybox" },        // box opens, notes rise
  {
    label: "Company Bank Details",
    path: "/company-bank",
    icon: BankIcon,
    implemented: true,
    color: "#0ea5e9",
    anim: "stamp",   // the pediment drops onto the columns
    // Never an employee: the payout account and the company's statutory
    // registrations are not self-service data.
    roles: ["founder", "company_admin", "hr_admin", "accounts_manager"],
  },
  { label: "Assets", path: "/assets", icon: AssetsIcon, implemented: true, color: "#22d3ee", anim: "lid" },                      // laptop lid opens
  { label: "Recruitment", path: "/recruitment", icon: RecruitmentIcon, implemented: true, color: "#f472b6", anim: "join", roles: ["founder", "company_admin", "hr_admin"] }, // the plus springs in, the figure nods
  { label: "Documents", path: "/documents", icon: DocumentsIcon, implemented: true, color: "#60a5fa", anim: "pageturn" },            // corner lifts, text writes in
  { label: "Calendar", path: "/calendar", icon: CalendarPagesIcon, implemented: true, color: "#fb7185", anim: "calpages" }, // pages flip one by one
  { label: "Announcements", path: "/announcements", icon: AnnouncementsIcon, implemented: true, color: "#fb923c", anim: "shout" }, // the horn recoils, rings leave the mouth
  // No role list: this is the point of the feature. HR starts the conversation,
  // and the employee has to be able to open it and answer — a Messages row HR
  // could see and the employee could not would be a noticeboard, not a chat.
  { label: "Messages", path: "/messages", icon: MessagesIcon, implemented: true, color: "#2dd4bf", anim: "reply" }, // one bubble speaks, the other answers
  { label: "Reports", path: "/reports", icon: ReportsIcon, implemented: true, color: "#c084fc", anim: "bars", roles: ["founder", "company_admin", "hr_admin"] },          // the bars grow out of the floor
  { label: "Settings", path: "/settings", icon: SettingsIcon, implemented: true, color: "#94a3b8", anim: "spin", roles: ["founder", "company_admin", "hr_admin"] },         // gear spins
]

import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarClock,
  FolderKanban,
  ListChecks,
  Wallet,
  Laptop,
  UserPlus,
  FileText,
  Calendar,
  Megaphone,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react"
import type { Role } from "@/features/auth/types"

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  implemented: boolean
  roles?: Role[]
}

export const navItems: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, implemented: true },
  { label: "Employees", path: "/employees", icon: Users, implemented: true },
  { label: "Attendance", path: "/attendance", icon: Clock, implemented: true },
  { label: "Leaves", path: "/leaves", icon: CalendarClock, implemented: true },
  { label: "Projects", path: "/projects", icon: FolderKanban, implemented: true },
  { label: "Tasks", path: "/tasks", icon: ListChecks, implemented: true },
  { label: "Payroll", path: "/payroll", icon: Wallet, implemented: true },
  { label: "Assets", path: "/assets", icon: Laptop, implemented: true },
  { label: "Recruitment", path: "/recruitment", icon: UserPlus, implemented: true, roles: ["founder", "hr_admin"] },
  { label: "Documents", path: "/documents", icon: FileText, implemented: true },
  { label: "Calendar", path: "/calendar", icon: Calendar, implemented: true },
  { label: "Announcements", path: "/announcements", icon: Megaphone, implemented: true },
  { label: "Reports", path: "/reports", icon: BarChart3, implemented: true, roles: ["founder", "hr_admin"] },
  { label: "Settings", path: "/settings", icon: Settings, implemented: true, roles: ["founder", "hr_admin"] },
]

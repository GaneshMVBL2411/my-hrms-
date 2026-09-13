import { useState } from "react"
import { NavLink } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { navItems } from "@/app/nav-config"
import { useAuth } from "@/features/auth/AuthContext"
import { cn } from "@/lib/utils"
import { CompanyLogo } from "@/features/auth/CompanyLogo"
import { listThreads } from "@/features/messages/api"

/**
 * Nav paths that correspond to a purchasable module. Dashboard, Profile and
 * anything else not listed here is always available.
 */
const MODULE_PATHS = new Set([
  "employees", "attendance", "leaves", "projects", "tasks", "payroll",
  "company_bank", "company-bank", "assets", "recruitment", "documents",
  "calendar", "announcements", "messages", "reports", "settings",
])

const COLLAPSE_KEY = "hrms_sidebar_collapsed"

export function Sidebar({
  className,
  onNavigate,
  collapsible = false,
}: {
  className?: string
  onNavigate?: () => void
  /** Desktop only: show the arrow that collapses the rail to icons. */
  collapsible?: boolean
}) {
  const { user } = useAuth()

  // Remembered across reloads so the rail stays how the user left it. Guarded
  // because storage can throw (private mode) or be empty on first visit.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1"
    } catch {
      return false
    }
  })
  const isCollapsed = collapsible && collapsed

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      } catch {
        // Not being able to remember the choice is not worth surfacing.
      }
      return next
    })
  }

  // The row clicked most recently and a counter that changes on every click.
  // The counter feeds the icon's React key, remounting it so its CSS animation
  // replays each time — even when the clicked row is already the active page.
  const [clicked, setClicked] = useState<{ path: string; nonce: number }>({ path: "", nonce: 0 })

  /**
   * Unread messages, shown on the Messages row.
   *
   * Without it neither side is told anything arrived, and an internal chat you
   * have to remember to go and check is not one people will use. The same query
   * the Messages page runs, so opening a thread clears the badge through the
   * shared cache rather than through a second source of truth.
   */
  const { data: threads } = useQuery({
    queryKey: ["messages", "threads"],
    queryFn: listThreads,
    enabled: Boolean(user) && !user?.isSuperAdmin,
    refetchInterval: 30_000,
  })
  const unread = threads?.reduce((total, t) => total + t.unread, 0) ?? 0

  const visibleItems = navItems.filter((item) => {
    if (!user) return false

    // 1. Super Admin has unrestricted access to all side options
    if (user.isSuperAdmin) return true

    // 2. Role-based check
    if (item.roles && !item.roles.includes(user.role)) return false

    // 3. Module gating for companies
    const moduleKey = item.path.replace(/^\//, "")
    const normalizedKey = moduleKey.replace(/-/g, "_")
    const gated = MODULE_PATHS.has(moduleKey) || MODULE_PATHS.has(normalizedKey)

    // Only gate if explicit modules are configured for this company
    if (gated && Array.isArray(user.modules) && user.modules.length > 0) {
      const isAllowed = user.modules.includes(moduleKey) || user.modules.includes(normalizedKey)
      if (!isAllowed) return false
    }

    return true
  })

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col border-r border-border bg-card transition-[width] duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-64",
        className
      )}
    >
      {/* The arrow that closes / opens the rail. Floats on the right border so
          it stays reachable in both states. Desktop only. */}
      {collapsible && (
        <button
          type="button"
          onClick={toggle}
          aria-label={isCollapsed ? "Open sidebar" : "Close sidebar"}
          title={isCollapsed ? "Open sidebar" : "Close sidebar"}
          className="absolute -right-3 top-6 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      )}

      <NavLink
        to="/dashboard"
        className={cn(
          "group flex items-center gap-2.5 py-5 select-none transition-all duration-200 cursor-pointer active:scale-95",
          isCollapsed ? "justify-center px-0" : "px-6"
        )}
      >
        <CompanyLogo className="size-9 shrink-0 object-contain" />
        {!isCollapsed && (
          <div className="min-w-0 leading-tight transition-transform duration-200 group-hover:translate-x-0.5">
            <p className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
              {user?.companyName ?? "HRMS Platform"}
            </p>
            <p className="text-xs text-muted-foreground">
              {user?.isSuperAdmin ? "Platform admin" : "HRMS"}
            </p>
          </div>
        )}
      </NavLink>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {visibleItems.map((item) => {
          const isAnimating = clicked.path === item.path
          return (
            <NavLink
              key={item.path}
              to={item.path}
              // A native tooltip is the label's stand-in once the text is hidden.
              title={isCollapsed ? item.label : undefined}
              onClick={() => {
                setClicked((prev) => ({ path: item.path, nonce: prev.nonce + 1 }))
                onNavigate?.()
              }}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 border-l-2 py-2.5 text-sm font-medium rounded-r-lg select-none transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.97] active:translate-x-0.5",
                  isCollapsed ? "justify-center px-0" : "px-3",
                  isActive
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "border-transparent text-secondary/80 hover:bg-muted hover:text-foreground dark:text-foreground/70"
                )
              }
            >
              <item.icon
                // Remounting on every click (key includes the nonce) restarts
                // the CSS animation, so it replays even on a repeat click.
                key={isAnimating ? `${item.path}-${clicked.nonce}` : item.path}
                className={cn(
                  "size-5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-active:scale-95",
                  isAnimating && `nav-anim-${item.anim}`
                )}
                style={{ color: item.color }}
              />
              {!isCollapsed && (
                <span className="truncate transition-transform duration-200 group-hover:translate-x-0.5">
                  {item.label}
                </span>
              )}
              {item.path === "/messages" && unread > 0 && (
                <span
                  // Collapsed, the rail has no room for a number, so the count
                  // becomes a dot on the icon — still visibly "something is
                  // waiting", which is the whole job of the badge.
                  className={cn(
                    "shrink-0 rounded-full bg-primary text-primary-foreground",
                    isCollapsed
                      ? "absolute right-3 top-2 size-2"
                      : "ml-auto min-w-5 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none"
                  )}
                  aria-label={`${unread} unread`}
                >
                  {isCollapsed ? "" : unread}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}

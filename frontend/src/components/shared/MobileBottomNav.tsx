import { useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Menu } from "lucide-react"
import { cn } from "@/lib/utils"
import { DashboardOrbitIcon } from "@/components/shared/DashboardOrbitIcon"
import { AttendanceIcon, LeavesIcon, TasksIcon } from "@/components/shared/nav-icons-3d"

interface MobileBottomNavProps {
  onMoreClick: () => void
}

export function MobileBottomNav({ onMoreClick }: MobileBottomNavProps) {
  const location = useLocation()
  const [clickedTab, setClickedTab] = useState<string | null>(null)

  const items = [
    {
      label: "Dashboard",
      path: "/dashboard",
      icon: DashboardOrbitIcon,
      color: "#5A9AA8",
      anim: "orbit",
    },
    {
      label: "Attendance",
      path: "/attendance",
      icon: AttendanceIcon,
      color: "#38bdf8",
      anim: "sweep",
    },
    {
      label: "Leaves",
      path: "/leaves",
      icon: LeavesIcon,
      color: "#fbbf24",
      anim: "daysoff",
    },
    {
      label: "Tasks",
      path: "/tasks",
      icon: TasksIcon,
      color: "#34d399",
      anim: "ticks",
    },
  ]

  const handleTabClick = (path: string) => {
    setClickedTab(path)
    setTimeout(() => setClickedTab(null), 600)
  }

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-around border-t border-border/70 bg-card/90 px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] backdrop-blur-xl transition-all duration-300 md:hidden shadow-[0_-4px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)]"
    >
      {items.map((item) => {
        const isActive = location.pathname.startsWith(item.path)
        const isPressed = clickedTab === item.path

        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => handleTabClick(item.path)}
            className={cn(
              "group relative flex flex-1 flex-col items-center justify-center py-1 select-none transition-all duration-200 active:scale-90",
              isActive ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive && (
              <span className="absolute -top-1.5 h-1 w-8 rounded-full bg-primary transition-all duration-300 animate-in fade-in zoom-in" />
            )}
            <div
              className={cn(
                "relative flex size-9 items-center justify-center rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                isActive && "bg-primary/10 scale-105",
                isPressed && "scale-80 rotate-[-8deg]"
              )}
            >
              <item.icon
                className={cn(
                  "size-5 transition-transform duration-300 group-hover:scale-110",
                  isPressed && `nav-anim-${item.anim}`
                )}
                style={{ color: item.color }}
              />
            </div>
            <span className="mt-0.5 text-[10px] tracking-tight truncate max-w-[64px] leading-tight">
              {item.label}
            </span>
          </NavLink>
        )
      })}

      {/* More / Menu tab */}
      <button
        type="button"
        onClick={() => {
          handleTabClick("more")
          onMoreClick()
        }}
        aria-label="Open all navigation options"
        className={cn(
          "group relative flex flex-1 flex-col items-center justify-center py-1 text-muted-foreground transition-all duration-200 active:scale-90 hover:text-foreground select-none"
        )}
      >
        <div
          className={cn(
            "relative flex size-9 items-center justify-center rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            clickedTab === "more" && "scale-80 rotate-12 bg-accent/40"
          )}
        >
          <Menu className="size-5 transition-transform duration-300 group-hover:scale-110 group-active:scale-80 text-foreground/80" />
        </div>
        <span className="mt-0.5 text-[10px] tracking-tight leading-tight">
          More
        </span>
      </button>
    </nav>
  )
}

import { NavLink } from "react-router-dom"
import { navItems } from "@/app/nav-config"
import { useAuth } from "@/features/auth/AuthContext"
import { cn } from "@/lib/utils"
import logoMark from "@/assets/logo-mark.png"

export function Sidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { user } = useAuth()
  const visibleItems = navItems.filter((item) => !item.roles || (user && item.roles.includes(user.role)))

  return (
    <aside className={cn("flex h-full w-64 flex-col border-r border-border bg-card", className)}>
      <div className="flex items-center gap-2 px-6 py-5">
        <img src={logoMark} alt="Whhohh Path" className="size-9 object-contain" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">Whhohh Path</p>
          <p className="text-xs text-muted-foreground">HRMS</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 border-l-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-transparent text-secondary/80 hover:bg-muted hover:text-foreground dark:text-foreground/70"
              )
            }
          >
            <item.icon className="size-4.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

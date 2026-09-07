import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { Search, Bell, Moon, Sun, LogOut, UserCircle, Menu } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAuth } from "@/features/auth/AuthContext"

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")

  const initials = (user?.fullName ?? user?.email ?? "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) navigate(`/employees?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:gap-4 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <form onSubmit={handleSearch} className="flex w-full min-w-0 max-w-[200px] sm:max-w-sm items-center">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform duration-200 group-focus-within:scale-110" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="h-9 rounded-xl pl-9 text-xs sm:text-sm bg-muted/40 transition-all focus:bg-background focus:ring-1"
          />
        </div>
      </form>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="size-4.5 transition-transform duration-500 hover:rotate-90" />
          ) : (
            <Moon className="size-4.5 transition-transform duration-500 hover:-rotate-12" />
          )}
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative rounded-xl" aria-label="Notifications">
              <Bell className="size-4.5" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-brand-accent" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 rounded-2xl p-4 shadow-lg border-border">
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <span className="text-[11px] text-muted-foreground">All caught up</span>
            </div>
            <div className="py-6 text-center text-xs text-muted-foreground">
              No new alerts at this time.
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 rounded-xl pl-2 pr-3 hover:bg-muted">
              <Avatar className="size-7 rounded-lg">
                <AvatarImage src={user?.photoUrl ?? undefined} alt={user?.fullName} />
                <AvatarFallback className="text-xs font-semibold rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start text-left sm:flex">
                <span className="text-xs font-semibold text-foreground leading-none">{user?.fullName}</span>
                <span className="text-[10px] text-muted-foreground capitalize mt-0.5">{user?.role?.replace("_", " ")}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 rounded-2xl p-1.5 shadow-lg border-border">
            <div className="px-2.5 py-2 border-b border-border mb-1">
              <p className="text-sm font-semibold text-foreground truncate">{user?.fullName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary capitalize">
                  {user?.role?.replace("_", " ")}
                </span>
                {user?.isSuperAdmin && (
                  <span className="inline-flex items-center rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                    Super Admin
                  </span>
                )}
              </div>
            </div>
            <DropdownMenuItem className="rounded-xl cursor-pointer" onClick={() => navigate("/profile")}>
              <UserCircle className="mr-2 size-4" />
              My Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-xl cursor-pointer" onClick={() => void signOut()} variant="destructive">
              <LogOut className="mr-2 size-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

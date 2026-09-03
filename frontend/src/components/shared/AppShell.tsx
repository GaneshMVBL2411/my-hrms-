import { useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { Sidebar } from "@/components/shared/Sidebar"
import { Topbar } from "@/components/shared/Topbar"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { SupportBanner } from "@/features/platform/SupportBanner"
import { MobileBottomNav } from "@/components/shared/MobileBottomNav"

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="app-shell flex h-svh w-full overflow-hidden bg-background">
      <Sidebar className="hidden md:flex" collapsible />

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 max-w-[80vw] gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar className="flex w-full border-r-0" onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Above the topbar, so it is the first thing on every screen while a
            platform admin is inside a customer's account. */}
        <SupportBanner />
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex flex-1 flex-col overflow-y-auto p-3 sm:p-4 md:p-6 pb-20 md:pb-6">
          <div key={location.pathname} className="animate-module-in flex flex-1 flex-col min-w-0">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile ergonomics: bottom navigation for instant single-thumb reach */}
      <MobileBottomNav onMoreClick={() => setMobileNavOpen(true)} />
    </div>
  )
}

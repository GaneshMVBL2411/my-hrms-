import { useEffect, useState } from "react"
import { useAuth } from "@/features/auth/AuthContext"
import logoMark from "@/assets/logo-mark.png"
import { cn } from "@/lib/utils"

/**
 * The signed-in tenant's logo, falling back to the platform mark.
 * Features realistic ambient floating physics and elastic tactile spring on click/tap.
 */
export function CompanyLogo({
  className,
  interactive = true,
  onClick,
}: {
  className?: string
  interactive?: boolean
  onClick?: () => void
}) {
  const { user } = useAuth()
  const [src, setSrc] = useState<string | null>(null)
  const [bouncing, setBouncing] = useState(false)

  const logoUrl = user?.companyLogoUrl ?? null

  useEffect(() => {
    if (!logoUrl) {
      setSrc(null)
      return
    }

    // Anything absolute is already publicly fetchable; only our own /files
    // paths need the Authorization header.
    if (!logoUrl.startsWith("/files/")) {
      setSrc(logoUrl)
      return
    }

    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001"
    const token = sessionStorage.getItem("hrms_token") ?? localStorage.getItem("hrms_token")
    if (!token) return

    let objectUrl: string | null = null
    let cancelled = false

    fetch(`${apiUrl}${logoUrl}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [logoUrl])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setBouncing(true)
    setTimeout(() => setBouncing(false), 650)
    onClick?.()
  }

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${user?.companyName ?? "HRMS"} Logo`}
      className={cn(
        "relative inline-flex items-center justify-center select-none",
        interactive && "logo-interactive",
        bouncing ? "logo-spring-active" : "logo-ambient"
      )}
    >
      <img
        src={src ?? logoMark}
        alt={user?.companyName ?? "HRMS"}
        className={cn("object-contain transition-all duration-300", className)}
      />
    </div>
  )
}

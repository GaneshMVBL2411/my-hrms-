import type { LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: "primary" | "success" | "warning" | "danger"
  unavailableReason?: string
  /**
   * Where the card leads. A stat is a summary of a list that exists elsewhere,
   * and the number invites a click — so give it the page it summarises, with
   * the same filter applied where the page reads one from the URL.
   *
   * Cards without a destination stay inert rather than looking clickable, and
   * an `unavailableReason` wins outright: there is nothing to show.
   */
  to?: string
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
  unavailableReason,
  to,
}: StatCardProps) {
  const isLink = Boolean(to) && !unavailableReason

  const content = (
    <Card
      className={cn(
        "rounded-xl border shadow-xs transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        isLink && "interactive-card group h-full hover:border-primary/50 hover:shadow-md active:scale-[0.98] cursor-pointer"
      )}
    >
      <CardContent className="flex items-center justify-between gap-3 p-4 sm:gap-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm text-muted-foreground truncate">{label}</p>
          <p className="mt-0.5 sm:mt-1 text-xl sm:text-2xl font-bold tracking-tight text-foreground">{value}</p>
        </div>
        <div
          className={cn(
            "flex size-10 sm:size-11 shrink-0 items-center justify-center rounded-xl transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            toneClasses[tone],
            isLink && "group-hover:scale-110 group-hover:shadow-sm group-active:scale-85 group-active:rotate-[-8deg]"
          )}
        >
          <Icon className="size-5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-active:scale-85" />
        </div>
      </CardContent>
    </Card>
  )

  if (unavailableReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>{unavailableReason}</TooltipContent>
      </Tooltip>
    )
  }

  if (!isLink) return content

  return (
    <Link
      to={to!}
      // The label and value are already read out by the link; naming the
      // destination as well is what tells someone where the click goes.
      aria-label={`${label}: ${value}. View details`}
      className="block h-full rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {content}
    </Link>
  )
}

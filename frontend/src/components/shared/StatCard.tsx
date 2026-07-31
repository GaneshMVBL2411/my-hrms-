import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: "primary" | "success" | "warning" | "danger"
  unavailableReason?: string
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
}

export function StatCard({ label, value, icon: Icon, tone = "primary", unavailableReason }: StatCardProps) {
  const content = (
    <Card className="rounded-md border shadow-none">
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <div className={cn("flex size-9 items-center justify-center rounded-md", toneClasses[tone])}>
          <Icon className="size-4.5" />
        </div>
      </CardContent>
    </Card>
  )

  if (!unavailableReason) return content

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{unavailableReason}</TooltipContent>
    </Tooltip>
  )
}

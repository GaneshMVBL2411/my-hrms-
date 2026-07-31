import { Construction } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md rounded-md border shadow-none">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Construction className="size-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This module is on the roadmap and will be enabled in an upcoming phase.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

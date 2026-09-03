import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { Plus, Pin, Pencil, Trash2, Megaphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { deleteAnnouncement, listAnnouncements } from "@/features/announcements/api"
import { AnnouncementFormDialog } from "@/features/announcements/AnnouncementFormDialog"
import { useAuth } from "@/features/auth/AuthContext"
import type { Announcement, AnnouncementCategory } from "@/features/announcements/types"

const categoryTone: Record<AnnouncementCategory, "success" | "warning" | "secondary" | "default"> = {
  news: "success",
  holiday: "warning",
  event: "default",
  general: "secondary",
}

export function AnnouncementsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isManager = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin"
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | undefined>(undefined)

  const { data: announcements, isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: listAnnouncements,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAnnouncement,
    onSuccess: () => {
      toast.success("Announcement removed")
      queryClient.invalidateQueries({ queryKey: ["announcements"] })
    },
    onError: () => toast.error("Could not remove announcement"),
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Announcements</h1>
        {isManager && (
          <Button
            className="rounded-md"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="mr-2 size-4" />
            New Announcement
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-32 w-full rounded-md" />}
      {!isLoading && (announcements?.length ?? 0) === 0 && (
        <Card className="rounded-md border shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Megaphone className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {announcements?.map((a) => (
          <Card key={a.id} className="rounded-md border shadow-none">
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {a.pinned && <Pin className="size-3.5 text-primary" />}
                  <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
                  <Badge variant={categoryTone[a.category]} className="capitalize">
                    {a.category}
                  </Badge>
                </div>
                {isManager && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditing(a)
                        setFormOpen(true)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Remove "${a.title}"?`)) deleteMutation.mutate(a.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-foreground">{a.body}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {a.createdByName} · {format(new Date(a.createdAt), "MMM d, yyyy")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AnnouncementFormDialog open={formOpen} onOpenChange={setFormOpen} announcement={editing} />
    </div>
  )
}

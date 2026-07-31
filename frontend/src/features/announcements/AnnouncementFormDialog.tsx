import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createAnnouncement, updateAnnouncement } from "@/features/announcements/api"
import type { Announcement } from "@/features/announcements/types"

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Body is required"),
  category: z.enum(["news", "holiday", "event", "general"]),
  pinned: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export function AnnouncementFormDialog({
  open,
  onOpenChange,
  announcement,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  announcement?: Announcement
}) {
  const isEdit = !!announcement
  const queryClient = useQueryClient()

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { category: "general", pinned: false } })

  useEffect(() => {
    if (!open) return
    reset({
      title: announcement?.title ?? "",
      body: announcement?.body ?? "",
      category: announcement?.category ?? "general",
      pinned: announcement?.pinned ?? false,
    })
  }, [open, announcement, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEdit ? updateAnnouncement(announcement!.id, values) : createAnnouncement(values),
    onSuccess: () => {
      toast.success(isEdit ? "Announcement updated" : "Announcement posted")
      queryClient.invalidateQueries({ queryKey: ["announcements"] })
      onOpenChange(false)
    },
    onError: () => toast.error("Could not save announcement"),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Announcement" : "New Announcement"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea rows={4} {...register("body")} />
            {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1.5">
              <Label>Category</Label>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="news">News</SelectItem>
                      <SelectItem value="holiday">Holiday</SelectItem>
                      <SelectItem value="event">Event</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
              <Checkbox checked={watch("pinned")} onCheckedChange={(c) => setValue("pinned", c === true)} />
              Pinned
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Post"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

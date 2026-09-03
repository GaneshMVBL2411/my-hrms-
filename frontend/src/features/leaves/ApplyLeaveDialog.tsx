import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { applyLeave, listTypes } from "@/features/leaves/api"
import { errorMessage } from "@/lib/errors"

const schema = z
  .object({
    leaveTypeId: z.string().min(1, "Select a leave type"),
    startDate: z.string().min(1, "Required"),
    endDate: z.string().min(1, "Required"),
    reason: z.string().optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  })

type FormValues = z.infer<typeof schema>

interface ApplyLeaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selects the type when opened from a balance card. */
  defaultLeaveTypeId?: number
}

export function ApplyLeaveDialog({ open, onOpenChange, defaultLeaveTypeId }: ApplyLeaveDialogProps) {
  const queryClient = useQueryClient()
  const { data: types = [] } = useQuery({ queryKey: ["leaves", "types"], queryFn: listTypes })

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // The dialog stays mounted between openings, so reset on the way in: without
  // this a second visit keeps the previous dates, and the type handed over from
  // a balance card would never reach the field.
  useEffect(() => {
    if (!open) return
    reset({
      leaveTypeId: defaultLeaveTypeId ? String(defaultLeaveTypeId) : "",
      startDate: "",
      endDate: "",
      reason: "",
    })
  }, [open, defaultLeaveTypeId, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      applyLeave({
        leaveTypeId: Number(values.leaveTypeId),
        startDate: values.startDate,
        endDate: values.endDate,
        reason: values.reason || undefined,
      }),
    onSuccess: () => {
      toast.success("Leave request submitted")
      queryClient.invalidateQueries({ queryKey: ["leaves"] })
      reset()
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not submit leave request"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-md">
        <DialogHeader>
          <DialogTitle>Apply for Leave</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Leave type</Label>
            <Controller
              control={control}
              name="leaveTypeId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.leaveTypeId && <p className="text-xs text-destructive">{errors.leaveTypeId.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input type="date" {...register("startDate")} />
              {errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>End date</Label>
              <Input type="date" {...register("endDate")} />
              {errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Textarea rows={3} {...register("reason")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

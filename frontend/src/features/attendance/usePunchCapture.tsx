import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { checkIn, checkOut } from "@/features/attendance/api"
import { CapturePunchDialog } from "@/features/attendance/CapturePunchDialog"
import { errorMessage } from "@/lib/errors"

/**
 * Check in and check out, with the photograph that now goes with them.
 *
 * A hook rather than a component because the buttons live in three different
 * places — the attendance page, the employee dashboard, and the dashboard's
 * attendance widget — each with its own layout. Wiring the camera into all
 * three separately would have meant three chances for them to drift, and the
 * ordering below is the part that must not.
 *
 * That ordering: the dialog opens, the photo is taken, and only then is the
 * punch recorded. Nothing is written while the camera is open, so cancelling
 * leaves no trace and a refused camera leaves no half-made record.
 *
 * Render `dialog` somewhere in the tree and call `punch("in")` from the
 * button. `isPending` covers the request, not the camera, so the button can
 * stay enabled while someone decides.
 */
export function usePunchCapture() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<"in" | "out" | null>(null)

  const mutation = useMutation({
    mutationFn: ({ direction, photo }: { direction: "in" | "out"; photo: string }) =>
      direction === "in" ? checkIn(photo) : checkOut(photo),
    onSuccess: (_data, variables) => {
      toast.success(variables.direction === "in" ? "Checked in" : "Checked out")
      // Every attendance query, because this changes today's row, the month's
      // list and the team view a manager may be looking at.
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
      setPending(null)
    },
    onError: (error, variables) => {
      toast.error(
        errorMessage(error, variables.direction === "in" ? "Could not check in" : "Could not check out")
      )
      // The dialog stays open on failure. "Already checked in today" wants
      // dismissing, but a dropped connection wants the same photo sent again,
      // and closing would have thrown it away.
      setPending(null)
    },
  })

  const dialog = pending ? (
    <CapturePunchDialog
      direction={pending}
      busy={mutation.isPending}
      onCancel={() => setPending(null)}
      onCapture={(photo) => mutation.mutate({ direction: pending, photo })}
    />
  ) : null

  return {
    punch: (direction: "in" | "out") => setPending(direction),
    isPending: mutation.isPending,
    dialog,
  }
}

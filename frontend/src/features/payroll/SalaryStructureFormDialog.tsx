import { useEffect } from "react"
import { useForm } from "react-hook-form"
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
import { getStructure, upsertStructure } from "@/features/payroll/api"

const schema = z.object({
  basic: z.string().min(1, "Required"),
  hra: z.string().min(1, "Required"),
  specialAllowance: z.string().min(1, "Required"),
  pfPercent: z.string().min(1, "Required"),
  esiPercent: z.string().min(1, "Required"),
  effectiveFrom: z.string().min(1, "Required"),
})

type FormValues = z.infer<typeof schema>

export function SalaryStructureFormDialog({
  employeeId,
  employeeName,
  open,
  onOpenChange,
}: {
  employeeId: number | null
  employeeName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const { data: existing } = useQuery({
    queryKey: ["payroll", "structure", employeeId],
    queryFn: () => getStructure(employeeId!),
    enabled: open && !!employeeId,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { pfPercent: "12", esiPercent: "0.75" },
  })

  useEffect(() => {
    if (!open) return
    reset({
      basic: existing ? String(existing.basic) : "",
      hra: existing ? String(existing.hra) : "",
      specialAllowance: existing ? String(existing.specialAllowance) : "",
      pfPercent: existing ? String(existing.pfPercent) : "12",
      esiPercent: existing ? String(existing.esiPercent) : "0.75",
      effectiveFrom: existing?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
    })
  }, [open, existing, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      upsertStructure(employeeId!, {
        basic: Number(values.basic),
        hra: Number(values.hra),
        specialAllowance: Number(values.specialAllowance),
        pfPercent: Number(values.pfPercent),
        esiPercent: Number(values.esiPercent),
        effectiveFrom: values.effectiveFrom,
      }),
    onSuccess: () => {
      toast.success("Salary structure saved")
      queryClient.invalidateQueries({ queryKey: ["payroll"] })
      onOpenChange(false)
    },
    onError: () => toast.error("Could not save salary structure"),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-md">
        <DialogHeader>
          <DialogTitle>Salary Structure — {employeeName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Basic</Label>
              <Input type="number" {...register("basic")} />
              {errors.basic && <p className="text-xs text-destructive">{errors.basic.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>HRA</Label>
              <Input type="number" {...register("hra")} />
              {errors.hra && <p className="text-xs text-destructive">{errors.hra.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Special allowance</Label>
            <Input type="number" {...register("specialAllowance")} />
            {errors.specialAllowance && <p className="text-xs text-destructive">{errors.specialAllowance.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>PF %</Label>
              <Input type="number" step="0.01" {...register("pfPercent")} />
            </div>
            <div className="space-y-1.5">
              <Label>ESI %</Label>
              <Input type="number" step="0.01" {...register("esiPercent")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Effective from</Label>
            <Input type="date" {...register("effectiveFrom")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

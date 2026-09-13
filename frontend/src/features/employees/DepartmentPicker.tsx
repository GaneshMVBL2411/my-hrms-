import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, Settings2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createDepartment, deleteDepartment } from "@/features/employees/api"
import type { Department } from "@/features/employees/types"
import { errorMessage } from "@/lib/errors"

export interface DepartmentPickerProps {
  value: string | undefined
  onChange: (value: string | undefined) => void
  departments: Department[]
  disabled?: boolean
  onPendingTitleChange?: (title: string) => void
}

export function DepartmentPicker({
  value,
  onChange,
  departments,
  disabled,
  onPendingTitleChange,
}: DepartmentPickerProps) {
  const queryClient = useQueryClient()
  const [isCustom, setIsCustom] = useState(false)
  const [customName, setCustomName] = useState("")
  const [manageOpen, setManageOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDepartment(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["departments"] })
      if (value === String(id)) {
        onChange(undefined)
      }
      toast.success("Department removed")
    },
    onError: (err) => toast.error(errorMessage(err, "Failed to remove department")),
  })

  const handleSelectChange = (val: string) => {
    if (val === "__new__") {
      setIsCustom(true)
      return
    }
    if (val === "none") {
      onChange(undefined)
      return
    }
    onChange(val)
  }

  const handleSaveCustom = async () => {
    const trimmed = customName.trim()
    if (!trimmed) return

    setIsSaving(true)
    try {
      // Check if already exists in list (case-insensitive)
      const existing = departments.find(
        (d) => d.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) {
        onChange(String(existing.id))
        setIsCustom(false)
        setCustomName("")
        onPendingTitleChange?.("")
        toast.info(`Selected existing department "${existing.name}"`)
        return
      }

      // Create in database & store
      const created = await createDepartment({ name: trimmed })
      await queryClient.invalidateQueries({ queryKey: ["departments"] })
      onChange(String(created.id))
      setIsCustom(false)
      setCustomName("")
      onPendingTitleChange?.("")
      toast.success(`Department "${created.name}" saved and added to dropdown!`)
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save department"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelCustom = () => {
    setIsCustom(false)
    setCustomName("")
    onPendingTitleChange?.("")
  }

  return (
    <div className="space-y-1.5">
      {/* Header row with Title and actions */}
      <div className="flex items-center justify-between">
        <Label>Department</Label>
        <div className="flex items-center gap-1.5">
          {!isCustom ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsCustom(true)}
                disabled={disabled}
                className="h-6 px-1.5 text-xs text-primary hover:text-primary gap-1 font-medium"
              >
                <Plus className="size-3" />
                Type manual
              </Button>
              {departments.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setManageOpen(true)}
                  disabled={disabled}
                  className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                  title="Manage departments list"
                >
                  <Settings2 className="size-3" />
                  Manage
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancelCustom}
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Choose from list
            </Button>
          )}
        </div>
      </div>

      {/* Manual Input mode */}
      {isCustom ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Type department (e.g. Sales, Marketing, HR)"
              value={customName}
              disabled={disabled || isSaving}
              onChange={(e) => {
                setCustomName(e.target.value)
                onPendingTitleChange?.(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSaveCustom()
                }
              }}
              autoFocus
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              disabled={!customName.trim() || disabled || isSaving}
              onClick={handleSaveCustom}
              className="shrink-0 gap-1"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              <span>Save & Select</span>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            This will be saved to your company departments and appear in the dropdown for all future employees.
          </p>
        </div>
      ) : (
        /* Dropdown Selection mode */
        <Select value={value || ""} onValueChange={handleSelectChange} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__new__" className="font-medium text-primary cursor-pointer">
              + Type / Add new department...
            </SelectItem>
            <SelectItem value="none" className="text-muted-foreground">
              None / Unassigned
            </SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Dialog to manage / remove default or custom departments */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-sm rounded-md">
          <DialogHeader>
            <DialogTitle>Manage Departments</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Remove any unwanted default or custom departments so they no longer appear in the dropdown.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto divide-y divide-border/50 py-1">
            {departments.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No departments found.</p>
            ) : (
              departments.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2 px-1 text-sm">
                  <span className="font-medium text-foreground">{d.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive h-7 w-7"
                    onClick={() => {
                      if (confirm(`Remove "${d.name}" from departments dropdown?`)) {
                        deleteMutation.mutate(d.id)
                      }
                    }}
                    title={`Delete ${d.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setManageOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

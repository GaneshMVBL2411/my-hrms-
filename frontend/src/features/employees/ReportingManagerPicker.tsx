import { useState, useMemo } from "react"
import { Search, UserCheck, X, UserX } from "lucide-react"
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
import type { EmployeeSummary } from "@/features/employees/types"

export interface ReportingManagerPickerProps {
  value: string | undefined
  onChange: (value: string | undefined) => void
  managers: EmployeeSummary[]
  disabled?: boolean
  currentEmployeeId?: number
}

const NONE = "none"

export function ReportingManagerPicker({
  value,
  onChange,
  managers,
  disabled,
  currentEmployeeId,
}: ReportingManagerPickerProps) {
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Filter out the current employee so nobody reports to themselves
  const eligibleManagers = useMemo(() => {
    return managers.filter((m) => m.id !== currentEmployeeId)
  }, [managers, currentEmployeeId])

  // Filtered list when searching
  const filteredManagers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return eligibleManagers
    return eligibleManagers.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q) ||
        (m.designationTitle && m.designationTitle.toLowerCase().includes(q)) ||
        (m.departmentName && m.departmentName.toLowerCase().includes(q)) ||
        m.email.toLowerCase().includes(q) ||
        m.employeeCode.toLowerCase().includes(q)
    )
  }, [eligibleManagers, searchQuery])

  // Get currently selected manager details
  const selectedManager = useMemo(() => {
    if (!value || value === NONE) return null
    return eligibleManagers.find((m) => String(m.id) === value) ?? null
  }, [eligibleManagers, value])

  const handleSelectChange = (val: string) => {
    if (val === "__search__") {
      setIsSearchMode(true)
      return
    }
    if (val === NONE) {
      onChange(undefined)
      return
    }
    onChange(val)
  }

  const handlePickManager = (managerId: number | null) => {
    if (managerId === null) {
      onChange(undefined)
    } else {
      onChange(String(managerId))
    }
    setIsSearchMode(false)
    setSearchQuery("")
  }

  return (
    <div className="space-y-1.5">
      {/* Header row with Label and action buttons */}
      <div className="flex items-center justify-between">
        <Label>Reporting manager</Label>
        <div className="flex items-center gap-1.5">
          {!isSearchMode ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsSearchMode(true)}
              disabled={disabled}
              className="h-6 px-1.5 text-xs text-primary hover:text-primary gap-1 font-medium"
            >
              <Search className="size-3" />
              Search / Type
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsSearchMode(false)
                setSearchQuery("")
              }}
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Choose from list
            </Button>
          )}
        </div>
      </div>

      {/* Search / Manual typing mode */}
      {isSearchMode ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Type manager name, email, or designation..."
              value={searchQuery}
              disabled={disabled}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="pl-8 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Quick list of matching managers */}
          <div className="max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-sm divide-y divide-border/50">
            {/* Option to clear manager */}
            <button
              type="button"
              onClick={() => handlePickManager(null)}
              className="w-full flex items-center gap-2 p-2 text-left text-xs rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <UserX className="size-4 shrink-0 text-muted-foreground" />
              <span>No reporting manager</span>
            </button>

            {filteredManagers.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No employee found matching &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              filteredManagers.map((m) => {
                const isSelected = value === String(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handlePickManager(m.id)}
                    className={`w-full flex items-center justify-between p-2 text-left text-xs rounded hover:bg-accent transition-colors ${
                      isSelected ? "bg-accent/80 font-medium" : ""
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{m.fullName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {[m.designationTitle, m.departmentName].filter(Boolean).join(" • ") || m.email}
                      </span>
                    </div>
                    {isSelected && <UserCheck className="size-4 text-primary shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      ) : (
        /* Dropdown Selection mode */
        <Select value={value || NONE} onValueChange={handleSelectChange} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="No reporting manager">
              {selectedManager
                ? `${selectedManager.fullName}${selectedManager.designationTitle ? ` — ${selectedManager.designationTitle}` : ""}`
                : "No reporting manager"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__search__" className="font-medium text-primary cursor-pointer">
              🔍 Search / Type manager name...
            </SelectItem>
            <SelectItem value={NONE} className="text-muted-foreground">
              No reporting manager
            </SelectItem>
            {eligibleManagers.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.fullName}
                {m.designationTitle ? ` — ${m.designationTitle}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

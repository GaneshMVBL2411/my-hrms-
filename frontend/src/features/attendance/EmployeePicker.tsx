import { useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import type { EmployeeSummary } from "@/features/employees/types"

/**
 * Picks any number of employees, by typing or by ticking.
 *
 * A plain Select could only ever mean "one of them" or "all of them", and the
 * question people actually bring to an attendance report is usually neither:
 * these four, or that team, or everyone except the contractors. Ticking boxes
 * in a searchable list answers all three without a mode switch.
 *
 * Nothing ticked means everyone, which is both the common case and the safe
 * default — an empty selection producing an empty report would be a trap.
 *
 * It closes on an explicit Done rather than on the first tick, because the
 * whole point is picking several. That button is not decoration: on a phone
 * the list covers the form, there is no "click outside" worth the name, and
 * without it people were left staring at the list with no way back.
 */
export function EmployeePicker({
  employees,
  selected,
  onChange,
  disabled,
}: {
  employees: EmployeeSummary[]
  selected: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
}) {
  const label =
    selected.length === 0
      ? "All employees"
      : selected.length === 1
        ? employees.find((e) => e.id === selected[0])?.fullName ?? "1 employee"
        : `${selected.length} employees`

  const [open, setOpen] = useState(false)

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-64 justify-between rounded-md font-normal"
          >
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search name or code…" />
            <CommandList>
              <CommandEmpty>No one matches that.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    onChange([])
                    setOpen(false)
                  }}
                  className="gap-2"
                >
                  <Check className={selected.length === 0 ? "size-4 opacity-100" : "size-4 opacity-0"} />
                  <span className="font-medium">All employees</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => onChange(employees.map((e) => e.id))}
                  className="gap-2 text-muted-foreground"
                >
                  <span className="size-4" />
                  Select every one individually
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Employees">
                {employees.map((employee) => (
                  <CommandItem
                    key={employee.id}
                    // Searched on both, because half the company knows each
                    // other by code and half by name.
                    value={`${employee.fullName} ${employee.employeeCode}`}
                    onSelect={() => toggle(employee.id)}
                    className="gap-2"
                  >
                    <Checkbox checked={selected.includes(employee.id)} className="pointer-events-none" />
                    <span className="truncate">{employee.fullName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{employee.employeeCode}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>

          {/* Outside the CommandList, so it stays put while the list scrolls. */}
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <span className="pl-1 text-xs text-muted-foreground">
              {selected.length === 0 ? "Everyone" : `${selected.length} selected`}
            </span>
            <div className="flex gap-1">
              {selected.length > 0 && (
                <Button variant="ghost" size="sm" className="h-8 rounded-md" onClick={() => onChange([])}>
                  Clear
                </Button>
              )}
              <Button size="sm" className="h-8 rounded-md" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Clear the selection"
          onClick={() => onChange([])}
          disabled={disabled}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

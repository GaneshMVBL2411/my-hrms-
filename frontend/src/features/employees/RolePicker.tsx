import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createCompanyRole, listAssignableRoles, type AssignableRole } from "@/features/employees/api"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** What the built-ins are called on screen. The database knows them by key. */
const BUILT_IN_LABELS: Record<string, string> = {
  founder: "Founder",
  hr_admin: "HR Admin",
  project_manager: "Project Manager",
  team_lead: "Team Lead",
  employee: "Employee",
}

/**
 * The only bases a company role may have — the same set HR can already hand
 * out directly. Listed here so the form offers exactly what the server will
 * accept, rather than letting someone pick Founder and be refused.
 */
const BASES: { value: NonNullable<AssignableRole["baseRole"]>; label: string; hint: string }[] = [
  { value: "employee", label: "Employee", hint: "Self-service access only" },
  { value: "team_lead", label: "Team Lead", hint: "Manages tasks for their team" },
  { value: "project_manager", label: "Project Manager", hint: "Manages projects and tasks" },
  { value: "hr_admin", label: "HR Admin", hint: "Manages people, payroll and documents" },
]

/**
 * Picks a role, or defines one.
 *
 * The role is not a label — it is the permission model, and the database
 * resolves every policy through it. So a role someone types here cannot just
 * be a new name: it has to say which built-in it grants the permissions of.
 * That is the second step below, and it is not skippable. A role that named
 * nothing about access would be a lie the next screen had to tell.
 *
 * Typing filters the list; typing something that matches nothing offers to
 * create it. The distinction between "choose" and "define" is kept visible
 * because it is a real one — the second creates something every HR admin in
 * the company will see from then on.
 */
export function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (role: string) => void
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [defining, setDefining] = useState<string | null>(null)
  const [base, setBase] = useState<NonNullable<AssignableRole["baseRole"]>>("employee")

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["roles", "assignable"],
    queryFn: listAssignableRoles,
  })

  const create = useMutation({
    mutationFn: ({ name, baseRole }: { name: string; baseRole: NonNullable<AssignableRole["baseRole"]> }) =>
      createCompanyRole(name, baseRole),
    onSuccess: (role) => {
      toast.success(`Role "${role.name}" created`)
      queryClient.invalidateQueries({ queryKey: ["roles", "assignable"] })
      onChange(role.name)
      setDefining(null)
      setSearch("")
      setOpen(false)
    },
    onError: (error) => toast.error(errorMessage(error, "Could not create that role")),
  })

  const labelFor = (name: string) => BUILT_IN_LABELS[name] ?? name
  const trimmed = search.trim()
  const exact = roles.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())
  const canOffer = trimmed.length >= 2 && !exact && !defining

  if (defining) {
    // Step two. A name alone is not a role; this is where it becomes one.
    return (
      <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" />
          <span>
            New role <b>{defining}</b> — what can it do?
          </span>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Same permissions as</Label>
          <Select value={base} onValueChange={(v) => setBase(v as typeof base)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASES.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  <span className="flex flex-col items-start">
                    <span>{b.label}</span>
                    <span className="text-[11px] text-muted-foreground">{b.hint}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            The name is what everyone sees. The permissions are what the system enforces, and
            they are exactly those of the role chosen here — no more.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setDefining(null)} disabled={create.isPending}>
            Back
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => create.mutate({ name: defining, baseRole: base })}
            disabled={create.isPending}
          >
            <Plus className="mr-1.5 size-3.5" />
            {create.isPending ? "Creating…" : "Create role"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className="w-full justify-between font-normal"
        >
          {value ? labelFor(value) : "Select role"}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder="Search or type a new role…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty className="p-2 text-xs text-muted-foreground">
              {trimmed.length < 2 ? "Type at least two characters" : "No role with that name"}
            </CommandEmpty>
            <CommandGroup heading="Roles">
              {roles.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.name}
                  onSelect={() => {
                    onChange(r.name)
                    setOpen(false)
                    setSearch("")
                  }}
                >
                  <Check className={cn("mr-2 size-4", value === r.name ? "opacity-100" : "opacity-0")} />
                  <span className="flex flex-1 flex-col">
                    <span>{labelFor(r.name)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {r.isCustom ? `Same access as ${labelFor(r.baseRole ?? "")}` : r.description}
                    </span>
                  </span>
                  {r.isCustom && (
                    <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      custom
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {canOffer && (
              // `forceMount` and a value that always matches: cmdk would
              // otherwise filter this item out for not containing the search
              // text, which is the opposite of when it is wanted.
              <CommandGroup heading="Not found">
                <CommandItem
                  value={`__create__ ${trimmed}`}
                  forceMount
                  onSelect={() => {
                    setDefining(trimmed)
                    setOpen(false)
                  }}
                  className="text-primary"
                >
                  <Plus className="mr-2 size-4" />
                  Create role &ldquo;{trimmed}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

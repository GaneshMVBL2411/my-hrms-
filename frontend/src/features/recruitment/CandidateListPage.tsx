import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { deleteCandidate, listCandidates } from "@/features/recruitment/api"
import { CandidateFormDialog } from "@/features/recruitment/CandidateFormDialog"
import { CandidateDetailDialog } from "@/features/recruitment/CandidateDetailDialog"
import type { CandidateStatus } from "@/features/recruitment/types"

const PAGE_SIZE = 10

const statusTone: Record<CandidateStatus, "secondary" | "warning" | "default" | "success" | "danger"> = {
  applied: "secondary",
  interview_scheduled: "warning",
  interviewed: "default",
  offered: "success",
  joined: "success",
  rejected: "danger",
}

export function CandidateListPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [formOpen, setFormOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["candidates", { search, statusFilter }],
    queryFn: () => listCandidates({ page: 1, pageSize: PAGE_SIZE, search: search || undefined, status: statusFilter }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCandidate,
    onSuccess: () => {
      toast.success("Candidate removed")
      queryClient.invalidateQueries({ queryKey: ["candidates"] })
    },
    onError: () => toast.error("Could not remove candidate"),
  })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Recruitment</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} candidates</p>
        </div>
        <Button className="rounded-md" onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 size-4" />
          Add Candidate
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search candidates..."
            className="rounded-md pl-9"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter ?? "all"} onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-full rounded-md sm:w-56">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="applied">Applied</SelectItem>
            <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
            <SelectItem value="interviewed">Interviewed</SelectItem>
            <SelectItem value="offered">Offered</SelectItem>
            <SelectItem value="joined">Joined</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead>Applied For</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (data?.items.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                  No candidates yet.
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedId(c.id)}>
                <TableCell>
                  <p className="text-sm font-medium text-foreground">{c.fullName}</p>
                  <p className="text-xs text-muted-foreground">{c.email}</p>
                </TableCell>
                <TableCell>{c.appliedDesignationTitle ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusTone[c.status]} className="capitalize">
                    {c.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Remove ${c.fullName}?`)) deleteMutation.mutate(c.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CandidateFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <CandidateDetailDialog
        candidateId={selectedId}
        open={!!selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  )
}

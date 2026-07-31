import { useState } from "react"
import { useForm, useWatch, Controller } from "react-hook-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { Plus, Pencil, Trash2, FileText, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { deletePolicy, generateLetter, listLetters, listPolicies, viewLetter } from "@/features/documents/api"
import { PolicyFormDialog } from "@/features/documents/PolicyFormDialog"
import { LetterView } from "@/features/documents/LetterView"
import { listEmployees } from "@/features/employees/api"
import { useAuth } from "@/features/auth/AuthContext"
import type { LetterPayload, LetterType, Policy } from "@/features/documents/types"

const letterTypes: { value: LetterType; label: string }[] = [
  { value: "offer", label: "Offer Letter" },
  { value: "appointment", label: "Appointment Letter" },
  { value: "experience", label: "Experience Letter" },
  { value: "relieving", label: "Relieving Letter" },
  { value: "certificate", label: "Certificate of Employment" },
]

interface GenerateForm {
  employeeId: string
  letterType: LetterType
  customMessage: string
  annualCtc: string
  probationText: string
  noticePeriodText: string
}

const DEFAULT_PROBATION_TEXT = "Six months from the date of joining"
const DEFAULT_NOTICE_PERIOD_TEXT = "Thirty days on either side after confirmation"

export function DocumentsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isManager = user?.role === "founder" || user?.role === "hr_admin"
  const [formOpen, setFormOpen] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | undefined>(undefined)
  const [letter, setLetter] = useState<LetterPayload | null>(null)
  const [viewingLetterId, setViewingLetterId] = useState<number | null>(null)

  const { data: policies, isLoading: loadingPolicies } = useQuery({
    queryKey: ["policies"],
    queryFn: listPolicies,
  })

  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: isManager,
  })

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ["letters", "history"],
    queryFn: listLetters,
  })

  const { data: viewedLetter } = useQuery({
    queryKey: ["letters", "view", viewingLetterId],
    queryFn: () => viewLetter(viewingLetterId!),
    enabled: !!viewingLetterId,
  })

  const deleteMutation = useMutation({
    mutationFn: deletePolicy,
    onSuccess: () => {
      toast.success("Policy removed")
      queryClient.invalidateQueries({ queryKey: ["policies"] })
    },
    onError: () => toast.error("Could not remove policy"),
  })

  const generateDefaults: GenerateForm = {
    employeeId: "",
    letterType: "offer",
    customMessage: "",
    annualCtc: "",
    probationText: DEFAULT_PROBATION_TEXT,
    noticePeriodText: DEFAULT_NOTICE_PERIOD_TEXT,
  }

  const { control, register, handleSubmit, reset } = useForm<GenerateForm>({
    defaultValues: generateDefaults,
  })
  const selectedLetterType = useWatch({ control, name: "letterType" })

  const generateMutation = useMutation({
    mutationFn: (values: GenerateForm) =>
      generateLetter({
        employeeId: Number(values.employeeId),
        letterType: values.letterType,
        customMessage: values.customMessage || undefined,
        annualCtc: values.annualCtc ? Number(values.annualCtc) : undefined,
        probationText: values.letterType === "offer" ? values.probationText || undefined : undefined,
        noticePeriodText: values.letterType === "offer" ? values.noticePeriodText || undefined : undefined,
      }),
    onSuccess: (data) => {
      setLetter(data)
      queryClient.invalidateQueries({ queryKey: ["letters"] })
      reset(generateDefaults)
    },
    onError: () => toast.error("Could not generate letter"),
  })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="text-xl font-semibold text-foreground">Documents</h1>

      <Tabs defaultValue="policies">
        <TabsList className="rounded-md">
          <TabsTrigger value="policies">Policies</TabsTrigger>
          {isManager && <TabsTrigger value="generate">Generate Letter</TabsTrigger>}
          <TabsTrigger value="history">{isManager ? "History" : "My Letters"}</TabsTrigger>
        </TabsList>

        <TabsContent value="policies" className="mt-4 flex flex-col gap-4">
          {isManager && (
            <div className="flex justify-end">
              <Button
                className="rounded-md"
                onClick={() => {
                  setEditingPolicy(undefined)
                  setFormOpen(true)
                }}
              >
                <Plus className="mr-2 size-4" />
                New Policy
              </Button>
            </div>
          )}

          {loadingPolicies && <Skeleton className="h-40 w-full rounded-md" />}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {policies?.map((policy) => (
              <Card key={policy.id} className="rounded-md border shadow-none">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{policy.title}</h3>
                    {isManager && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditingPolicy(policy)
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
                            if (confirm(`Remove "${policy.title}"?`)) deleteMutation.mutate(policy.id)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{policy.content}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    v{policy.version} · updated by {policy.updatedByName}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {isManager && (
          <TabsContent value="generate" className="mt-4">
            <Card className="max-w-lg rounded-md border shadow-none">
              <CardContent className="space-y-4 py-6">
                <div className="space-y-1.5">
                  <Label>Employee</Label>
                  <Controller
                    control={control}
                    name="employeeId"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees?.items.map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>
                              {e.fullName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Letter type</Label>
                  <Controller
                    control={control}
                    name="letterType"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {letterTypes.map((lt) => (
                            <SelectItem key={lt.value} value={lt.value}>
                              {lt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {selectedLetterType === "offer" && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Annual CTC (optional)</Label>
                      <Input type="number" placeholder="e.g. 900000" className="rounded-md" {...register("annualCtc")} />
                      <p className="text-xs text-muted-foreground">
                        Leave blank to use the employee's configured salary structure, if any.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Probation</Label>
                      <Input type="text" className="rounded-md" {...register("probationText")} />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Notice period</Label>
                      <Input type="text" className="rounded-md" {...register("noticePeriodText")} />
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label>Custom message (optional)</Label>
                  <Textarea rows={3} {...register("customMessage")} />
                </div>

                <Button
                  className="w-full rounded-md"
                  disabled={generateMutation.isPending}
                  onClick={handleSubmit((values) => generateMutation.mutate(values))}
                >
                  <FileText className="mr-2 size-4" />
                  Generate
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="history" className="mt-4">
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  {isManager && <TableHead>Employee</TableHead>}
                  <TableHead>Letter Type</TableHead>
                  <TableHead>Generated By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory && (
                  <TableRow>
                    <TableCell colSpan={isManager ? 5 : 4}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingHistory && (history?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={isManager ? 5 : 4} className="py-8 text-center text-sm text-muted-foreground">
                      {isManager ? "No letters generated yet." : "No documents have been issued to you yet."}
                    </TableCell>
                  </TableRow>
                )}
                {history?.map((h) => (
                  <TableRow key={h.id}>
                    {isManager && <TableCell className="font-medium text-foreground">{h.employeeName}</TableCell>}
                    <TableCell className="capitalize">{h.letterType}</TableCell>
                    <TableCell>{h.generatedByName}</TableCell>
                    <TableCell>{format(new Date(h.generatedAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" onClick={() => setViewingLetterId(h.id)}>
                        <Eye className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <PolicyFormDialog open={formOpen} onOpenChange={setFormOpen} policy={editingPolicy} />
      <LetterView
        letter={letter ?? viewedLetter ?? null}
        open={!!letter || !!viewingLetterId}
        onOpenChange={(open) => {
          if (!open) {
            setLetter(null)
            setViewingLetterId(null)
          }
        }}
      />
    </div>
  )
}

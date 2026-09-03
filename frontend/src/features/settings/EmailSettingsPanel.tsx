import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, Mail, Send, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/shared/PasswordInput"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  checkSmtpHealth,
  getEmailSettings,
  listEmailLogs,
  saveEmailSettings,
  sendTestEmail,
} from "@/features/settings/emailApi"
import { useAuth } from "@/features/auth/AuthContext"
import { errorMessage } from "@/lib/errors"

/**
 * SMTP settings for this company.
 *
 * The password field is the interesting part. It is never populated — the API
 * has no route that returns a stored password, so there is nothing to populate
 * it with — and leaving it blank on save keeps whatever is stored. That is why
 * the placeholder says so: an administrator who sees an empty box next to a
 * host they configured last month needs to know they have not just wiped it.
 *
 * Everything here is company-scoped by the session. There is no company field
 * on this form, and there is no route that accepts one.
 */
export function EmailSettingsPanel() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [host, setHost] = useState("")
  const [port, setPort] = useState("587")
  const [secure, setSecure] = useState("false")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [fromEmail, setFromEmail] = useState("")
  const [fromName, setFromName] = useState("")
  const [replyTo, setReplyTo] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [testTo, setTestTo] = useState(user?.email ?? "")

  const { data: settings, isLoading } = useQuery({
    queryKey: ["email", "settings"],
    queryFn: getEmailSettings,
  })

  const { data: health, isFetching: checking, refetch: recheck } = useQuery({
    queryKey: ["email", "health"],
    queryFn: checkSmtpHealth,
  })

  const { data: logs } = useQuery({ queryKey: ["email", "logs"], queryFn: listEmailLogs })

  useEffect(() => {
    if (!settings?.configured) return
    setHost(settings.host ?? "")
    setPort(String(settings.port ?? 587))
    setSecure(String(Boolean(settings.secure)))
    setUsername(settings.username ?? "")
    setFromEmail(settings.from_email ?? "")
    setFromName(settings.from_name ?? "")
    setReplyTo(settings.reply_to ?? "")
    setEnabled(Boolean(settings.enabled))
    // The password is deliberately not set here. There is nothing to set it to.
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: () =>
      saveEmailSettings({
        host: host.trim(),
        port: Number(port),
        secure: secure === "true",
        username: username.trim() || undefined,
        // Blank means "keep what is stored", which is the whole reason the
        // browser never needs to hold the real value.
        password: password || undefined,
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim() || undefined,
        replyTo: replyTo.trim() || undefined,
        enabled,
      }),
    onSuccess: () => {
      toast.success("Email settings saved")
      setPassword("")
      queryClient.invalidateQueries({ queryKey: ["email"] })
    },
    onError: (error) => toast.error(errorMessage(error, "Could not save the email settings")),
  })

  const testMutation = useMutation({
    mutationFn: () => sendTestEmail(testTo.trim()),
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ["email", "logs"] })
    },
    onError: (error) => toast.error(errorMessage(error, "The test email could not be sent")),
  })

  // Port and TLS travel together, and getting the pair wrong is the single most
  // common SMTP misconfiguration — so the form says which is which rather than
  // leaving it to be discovered by timeout.
  const onPortChange = (value: string) => {
    setPort(value)
    if (value === "465") setSecure("true")
    if (value === "587" || value === "25") setSecure("false")
  }

  const connected = health?.smtp === "connected"
  const devMode = (settings?.mode ?? health?.mode) === "development"

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />

  return (
    <div className="flex flex-col gap-4">
      {devMode && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <strong>Development mode.</strong> Emails are written to the server log and not delivered.
          Set <code className="rounded bg-muted px-1">EMAIL_MODE=production</code> on the backend to
          send for real.
        </div>
      )}

      <Card className="rounded-xl">
        <CardContent className="flex flex-col gap-5 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="size-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Email / SMTP settings</h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={connected ? "success" : "warning"} className="gap-1.5">
                <span
                  className={`inline-block size-2 rounded-full ${connected ? "bg-success" : "bg-warning"}`}
                />
                {connected ? "Connected" : health?.smtp === "unavailable" ? "Not connected" : "Unknown"}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => recheck()} disabled={checking}>
                {checking && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Test connection
              </Button>
            </div>
          </div>

          {health?.reason && !connected && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{health.reason}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SMTP host" htmlFor="smtp-host">
              <Input
                id="smtp-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.example.com"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Port" htmlFor="smtp-port">
                <Select value={port} onValueChange={onPortChange}>
                  <SelectTrigger id="smtp-port">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="587">587</SelectItem>
                    <SelectItem value="465">465</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Encryption" htmlFor="smtp-secure">
                <Select value={secure} onValueChange={setSecure}>
                  <SelectTrigger id="smtp-secure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">STARTTLS</SelectItem>
                    <SelectItem value="true">TLS (implicit)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="SMTP username" htmlFor="smtp-user">
              <Input
                id="smtp-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </Field>

            <Field
              label="SMTP password"
              htmlFor="smtp-pass"
              hint={
                settings?.has_password
                  ? "A password is stored. Leave blank to keep it."
                  : "No password stored yet."
              }
            >
              <PasswordInput
                id="smtp-pass"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={settings?.has_password ? "••••••••••••" : ""}
                autoComplete="new-password"
              />
            </Field>

            <Field label="From email" htmlFor="smtp-from">
              <Input
                id="smtp-from"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="no-reply@example.com"
              />
            </Field>

            <Field label="From name" htmlFor="smtp-from-name">
              <Input
                id="smtp-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder={user?.companyName ?? "HRMS"}
              />
            </Field>

            <Field label="Reply-to" htmlFor="smtp-reply" hint="Where replies from employees should go.">
              <Input
                id="smtp-reply"
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="hr@example.com"
              />
            </Field>

            <Field label="Use this server" htmlFor="smtp-enabled" hint="Off means the platform's mail server is used.">
              <Select value={String(enabled)} onValueChange={(v) => setEnabled(v === "true")}>
                <SelectTrigger id="smtp-enabled">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Use our own SMTP</SelectItem>
                  <SelectItem value="false">Use the platform's</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !host.trim()}>
              {saveMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save settings
            </Button>
            <div className="ml-auto flex items-end gap-2">
              <Input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                className="w-56"
                aria-label="Address to send a test email to"
              />
              <Button
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !testTo.trim()}
              >
                {testMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                Send test email
              </Button>
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            The password is encrypted before it is stored and is never sent back to this page. Nothing
            here is visible to another company.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardContent className="py-6">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Recent email activity</h3>
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No emails sent yet.
                    </TableCell>
                  </TableRow>
                )}
                {logs?.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-48 truncate">{row.recipient}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{row.subject}</TableCell>
                    <TableCell className="text-muted-foreground">{row.template ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "sent" ? "success" : row.status === "failed" ? "danger" : "warning"
                        }
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

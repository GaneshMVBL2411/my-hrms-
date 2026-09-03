import { apiRequest } from "@/lib/supabase"

/**
 * The email settings API, as the browser sees it.
 *
 * Note what is missing: there is no way to read an SMTP password. The server
 * has no route that returns one, so this client has no function that could ask
 * for one — `hasPassword` is all the screen needs to decide between "•••••" and
 * an empty field.
 *
 * These are explicit endpoints rather than the generic query client used
 * everywhere else in this app. That is deliberate: SMTP settings are not a
 * table this frontend may write.
 */

export interface EmailSettings {
  configured: boolean
  host?: string
  port?: number
  secure?: boolean
  username?: string | null
  /** Whether a password is stored. Never the password itself. */
  has_password?: boolean
  from_email?: string
  from_name?: string | null
  reply_to?: string | null
  enabled?: boolean
  updated_at?: string
  mode?: "development" | "production"
}

export interface EmailSettingsInput {
  host: string
  port: number
  secure: boolean
  username?: string
  /** Omit to keep the stored password. Sending "" would not clear it either. */
  password?: string
  fromEmail: string
  fromName?: string
  replyTo?: string
  enabled: boolean
}

export async function getEmailSettings(): Promise<EmailSettings> {
  return apiRequest("/admin/email/settings")
}

export async function saveEmailSettings(input: EmailSettingsInput): Promise<{ ok: boolean }> {
  return apiRequest("/admin/email/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

/** Reports only whether the mail server answered — never why, in detail. */
export async function checkSmtpHealth(): Promise<{
  smtp: "connected" | "unavailable"
  mode: string
  reason?: string
}> {
  return apiRequest("/admin/email/health")
}

export async function sendTestEmail(email: string): Promise<{ success: boolean; message: string }> {
  return apiRequest("/admin/email/test", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export interface EmailLogRow {
  id: number
  recipient: string
  subject: string
  template: string | null
  status: "queued" | "sending" | "sent" | "failed"
  error_message: string | null
  created_at: string
  sent_at: string | null
}

export async function listEmailLogs(): Promise<EmailLogRow[]> {
  const body = await apiRequest("/admin/email/logs")
  return (body?.data ?? []) as EmailLogRow[]
}

import nodemailer, { type Transporter } from "nodemailer"
import { withoutSession } from "../db.js"
import {
  appBaseUrl,
  decryptSecret,
  emailMode,
  platformSmtp,
  scrubSecrets,
  type SmtpConfig,
} from "./config.js"
import {
  isTemplateName,
  render,
  type Branding,
  type TemplateData,
  type TemplateName,
} from "./templates.js"

/**
 * The HRMS email service.
 *
 * One way out of the application and into SMTP. Everything that sends mail —
 * onboarding, leave decisions, payslips, announcements — goes through
 * `sendTemplateEmail`, so the rules about who may be a sender, what gets
 * logged, and what happens when the mail server is down are written once.
 *
 * Three properties this file exists to hold:
 *
 *   The sender is never the caller's choice. `from` comes from configuration,
 *   full stop. An HRMS that let a caller pick a From address would be an open
 *   relay wearing a payroll system's clothes, and the request would look
 *   entirely ordinary in the logs.
 *
 *   A failure to send is never a failure of the thing that triggered it.
 *   Approving leave writes to the database and then sends an email; if SMTP is
 *   unreachable the approval still stands. `sendTemplateEmail` therefore
 *   resolves with a result rather than throwing at its callers.
 *
 *   Nothing that reaches a log or an API response contains a credential. SMTP
 *   servers quote the failing command back, and a failing AUTH contains the
 *   base64 of the username and password — so every error text is scrubbed on
 *   the way out.
 */

// ------------------------------------------------------------------- limits
const MAX_SUBJECT = 500
const MAX_HTML_BYTES = 512 * 1024
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_RECIPIENTS = 50

/**
 * Addresses, conservatively.
 *
 * Not RFC 5322 — that grammar admits quoted strings and comments, and an
 * address containing a quoted newline is exactly the header injection this is
 * here to stop. Refusing a handful of legal-but-bizarre addresses is the right
 * trade for a pattern that cannot be talked into a second header.
 */
const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && ADDRESS.test(value.trim())
}

/**
 * Refuses anything that could open a second header.
 *
 * CR and LF are the classic vector: a display name of `HR\r\nBcc: everyone@…`
 * becomes a real Bcc when concatenated into a header. Nodemailer encodes
 * headers itself and would not be fooled by most of this, but "the library
 * probably handles it" is not a control — this is.
 */
export function assertHeaderSafe(value: string, field: string): string {
  if (/[\r\n\u2028\u2029\0]/.test(value)) {
    throw new EmailError(`Invalid characters in ${field}`, "invalid_header")
  }
  return value
}

export class EmailError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = "EmailError"
  }
}

export interface Attachment {
  filename: string
  content: Buffer
  contentType: string
}

export interface SendOptions {
  to: string | string[]
  subject: string
  html: string
  text: string
  attachments?: Attachment[]
  /** Tenant whose SMTP and branding apply, and whose log the row belongs to. */
  companyId?: number | null
  /** Recorded on the log row so "did the payslip mail go out" is answerable. */
  template?: string
  replyTo?: string
}

export interface SendResult {
  ok: boolean
  /** Safe to show a user. Never contains a host, a username or a provider error. */
  message: string
  messageId?: string
  logId?: number
}

// ---------------------------------------------------------------- transport
interface CachedTransport {
  transporter: Transporter
  config: SmtpConfig
}

/**
 * Transports are cached per tenant, because creating one per message throws
 * away the connection pool and makes every send pay a TLS handshake.
 *
 * Keyed by company id, with `null` for the platform transport. The cache is
 * cleared when a tenant's settings change — see `forgetTransport`.
 */
const transports = new Map<string, CachedTransport>()

function buildTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 speaks TLS from the first byte; 587 and 25 start in clear and are
    // upgraded. `requireTLS` makes that upgrade mandatory rather than
    // best-effort, so a server that does not offer STARTTLS fails instead of
    // silently sending credentials in the clear.
    secure: config.secure,
    requireTLS: !config.secure,
    auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    tls: {
      // Refusing an invalid certificate is the default and is left alone
      // deliberately: an HRMS sending payslip notifications must not be
      // talkable into trusting whatever answers on port 587.
      minVersion: "TLSv1.2",
    },
  })
}

/**
 * Reads a tenant's own SMTP settings, if it has any and they are enabled.
 *
 * The decryption happens here and the plaintext never leaves this function's
 * return value, which goes straight into a transport. It is not returned to a
 * route, not logged, and not stored.
 */
async function tenantSmtp(companyId: number | null): Promise<SmtpConfig | null> {
  if (companyId === null) return null

  try {
    const row = await withoutSession(async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> | null }>(
        "select public.get_company_smtp_transport($1) as result",
        [companyId]
      )
      return rows[0]?.result ?? null
    })
    if (!row) return null

    const cipher = row.password_ciphertext as string | null
    return {
      host: String(row.host),
      port: Number(row.port),
      secure: Boolean(row.secure),
      user: (row.username as string | null) ?? undefined,
      password: cipher ? decryptSecret(cipher) : undefined,
      fromEmail: String(row.from_email),
      fromName: (row.from_name as string | null) ?? "HRMS",
      replyTo: (row.reply_to as string | null) ?? undefined,
    }
  } catch (error) {
    // A tenant whose credential will not decrypt must not fall back to the
    // platform's transport: their mail would go out from the wrong domain,
    // which is worse than not going out. Log and refuse.
    console.error(
      `[email] tenant ${companyId} SMTP settings unusable:`,
      scrubSecrets((error as Error).message)
    )
    throw new EmailError("This company's email settings are not usable", "tenant_smtp_invalid")
  }
}

/**
 * The transport for a tenant: their own if configured, the platform's if not.
 *
 * This is the fallback the architecture asks for, and it is one line because
 * the decision belongs in one place — every caller gets the same answer.
 */
async function transportFor(companyId: number | null): Promise<CachedTransport> {
  const key = companyId === null ? "platform" : `company:${companyId}`
  const cached = transports.get(key)
  if (cached) return cached

  const config = (await tenantSmtp(companyId)) ?? platformSmtp()
  if (!config) {
    throw new EmailError(
      "Email is not configured on this server",
      "not_configured"
    )
  }

  const entry = { transporter: buildTransport(config), config }
  transports.set(key, entry)
  return entry
}

/** Drops a cached transport so the next send picks up changed settings. */
export function forgetTransport(companyId: number | null): void {
  const key = companyId === null ? "platform" : `company:${companyId}`
  transports.get(key)?.transporter.close()
  transports.delete(key)
}

// ------------------------------------------------------------------ sending
/**
 * Whether the mail server can be reached and authenticated against.
 *
 * Used by the health check and by the settings screen's "Test connection".
 * Returns a result rather than throwing, and the reason it returns is written
 * for an administrator to read — never the provider's own text, which quotes
 * the failing command back and can contain credentials.
 */
export async function verifySMTPConnection(
  companyId: number | null = null
): Promise<{ connected: boolean; reason?: string; mode: string }> {
  const mode = emailMode()
  if (mode === "development") {
    return { connected: false, mode, reason: "Running in development mode — no mail is sent." }
  }

  try {
    const { transporter } = await transportFor(companyId)
    await transporter.verify()
    return { connected: true, mode }
  } catch (error) {
    const err = error as { code?: string; responseCode?: number; message?: string }
    console.error("[email] verify failed:", scrubSecrets(err.message ?? String(error)))
    return { connected: false, mode, reason: friendlyReason(err) }
  }
}

/**
 * Turns a provider failure into something safe to show.
 *
 * "535 Authentication failed: username/password incorrect" names the failure
 * *and* confirms to anyone who can reach this endpoint that they have found a
 * live mail configuration. These messages say what an administrator can act
 * on and nothing else; the detail goes to the server log.
 */
function friendlyReason(err: { code?: string; responseCode?: number }): string {
  switch (err.code) {
    case "EAUTH":
      return "The mail server rejected the username or password."
    case "ECONNECTION":
    case "ECONNREFUSED":
    case "EHOSTUNREACH":
      return "The mail server could not be reached. Check the host and port."
    case "ETIMEDOUT":
    case "ESOCKET":
      return "The connection to the mail server timed out. Check the port and whether TLS is required."
    case "not_configured":
      return "Email is not configured on this server."
    default:
      if (err.responseCode && err.responseCode >= 500) return "The mail server refused the message."
      return "The email service is temporarily unavailable."
  }
}

function normaliseRecipients(to: string | string[]): string[] {
  const list = (Array.isArray(to) ? to : [to]).map((a) => String(a).trim()).filter(Boolean)
  if (list.length === 0) throw new EmailError("No recipient given", "no_recipient")
  if (list.length > MAX_RECIPIENTS) {
    throw new EmailError(`Too many recipients in one message (max ${MAX_RECIPIENTS})`, "too_many_recipients")
  }
  for (const address of list) {
    if (!isValidAddress(address)) throw new EmailError("Invalid recipient address", "invalid_recipient")
    assertHeaderSafe(address, "recipient")
  }
  return list
}

function checkAttachments(attachments: Attachment[]): void {
  let total = 0
  for (const a of attachments) {
    // Filenames go into a header and into a filesystem-shaped field. A name
    // containing a path separator is either a traversal attempt or a bug, and
    // neither should reach a mail client.
    if (/[\\/]|\.\./.test(a.filename)) {
      throw new EmailError("Invalid attachment filename", "invalid_attachment")
    }
    assertHeaderSafe(a.filename, "attachment filename")
    if (!Buffer.isBuffer(a.content)) {
      throw new EmailError("Attachment content must be a buffer", "invalid_attachment")
    }
    if (a.content.length > MAX_ATTACHMENT_BYTES) {
      throw new EmailError("Attachment is too large", "attachment_too_large")
    }
    total += a.content.length
  }
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new EmailError("Attachments are too large in total", "attachment_too_large")
  }
}

/**
 * Sends one message.
 *
 * Callers should prefer `sendTemplateEmail`; this is the layer beneath it and
 * the one that talks to SMTP.
 */
export async function sendEmail(options: SendOptions): Promise<SendResult> {
  const recipients = normaliseRecipients(options.to)
  const subject = assertHeaderSafe(String(options.subject ?? "").slice(0, MAX_SUBJECT), "subject")
  if (!subject.trim()) throw new EmailError("Subject is required", "no_subject")

  if (Buffer.byteLength(options.html ?? "", "utf8") > MAX_HTML_BYTES) {
    throw new EmailError("Email body is too large", "body_too_large")
  }
  if (options.attachments?.length) checkAttachments(options.attachments)

  const companyId = options.companyId ?? null
  const mode = emailMode()

  // Development mode short-circuits before a transport is needed, because not
  // needing one is the point: a developer with no SMTP credentials must still
  // be able to exercise every path that sends. Demanding a transport first
  // made "Send test email" fail with "not configured" on exactly the machines
  // this mode exists for.
  //
  // The metadata is logged so a developer can see the send happened and to
  // whom. The body is not: a rendered password-reset email contains a working
  // token, and a terminal is not the place for it.
  if (mode === "development") {
    const devSender = platformSmtp()?.fromEmail ?? "dev@localhost"
    const devLogId = await openLog(companyId, recipients.join(", "), devSender, subject, options.template)
    console.info(
      `[email:dev] would send "${subject}" to ${recipients.join(", ")} ` +
        `(template=${options.template ?? "none"}, company=${companyId ?? "platform"})`
    )
    await closeLog(devLogId, "sent", "development-mode")
    return { ok: true, message: "Email logged in development mode (not sent)", logId: devLogId }
  }

  let transport: CachedTransport
  try {
    transport = await transportFor(companyId)
  } catch (error) {
    const code = error instanceof EmailError ? error.code : "not_configured"
    await recordFailure(companyId, recipients[0]!, "unconfigured", subject, options.template, code, (error as Error).message)
    return { ok: false, message: friendlyReason({ code }) }
  }

  const { transporter, config } = transport
  const from = { name: assertHeaderSafe(config.fromName, "from name"), address: config.fromEmail }

  // A reply-to may be supplied by an event (so a leave notification can point
  // at HR), but it is validated like any other address and never taken from a
  // request body — see the routes, which do not accept one.
  const replyTo = options.replyTo ?? config.replyTo
  if (replyTo && !isValidAddress(replyTo)) {
    throw new EmailError("Invalid reply-to address", "invalid_reply_to")
  }

  const logId = await openLog(companyId, recipients.join(", "), config.fromEmail, subject, options.template)

  try {
    const info = await transporter.sendMail({
      from,
      to: recipients,
      replyTo,
      subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    })
    await closeLog(logId, "sent", info.messageId)
    return { ok: true, message: "Email sent", messageId: info.messageId, logId }
  } catch (error) {
    const err = error as { code?: string; responseCode?: number; message?: string }
    console.error(
      `[email] send failed (template=${options.template ?? "none"}):`,
      scrubSecrets(err.message ?? String(error))
    )
    await closeLog(logId, "failed", undefined, err.code ?? String(err.responseCode ?? "unknown"), scrubSecrets(err.message ?? ""))
    return { ok: false, message: friendlyReason(err), logId }
  }
}

/**
 * Renders a template for a tenant and sends it.
 *
 * This is what HRMS events call. The branding is read from the tenant, so the
 * mail says the customer's name rather than the platform's, and a failure is
 * returned rather than thrown — the leave decision that triggered it has
 * already been committed and must not be undone by a mail server.
 */
export async function sendTemplateEmail(params: {
  to: string | string[]
  template: TemplateName | string
  data: TemplateData
  companyId?: number | null
  replyTo?: string
  attachments?: Attachment[]
}): Promise<SendResult> {
  if (!isTemplateName(params.template)) {
    throw new EmailError(`Unknown email template: ${String(params.template)}`, "unknown_template")
  }

  const companyId = params.companyId ?? null
  const branding = await brandingFor(companyId)
  const rendered = render(params.template, { ...params.data, ...linkData(params.data) }, branding)

  try {
    return await sendEmail({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      companyId,
      template: params.template,
      replyTo: params.replyTo,
      attachments: params.attachments,
    })
  } catch (error) {
    // Validation failures reach here (a bad address on a generated email, say).
    // They are a bug worth logging, not a reason to fail the HRMS action.
    console.error("[email] template send rejected:", scrubSecrets((error as Error).message))
    return { ok: false, message: "The email could not be prepared" }
  }
}

/** Turns a relative `path` in the data into an absolute link, if a base is set. */
function linkData(data: TemplateData): TemplateData {
  const base = appBaseUrl()
  const path = data.path
  if (!base || typeof path !== "string") return {}
  return { actionUrl: `${base}${path.startsWith("/") ? path : `/${path}`}` }
}

/**
 * The tenant's own name and logo.
 *
 * Falls back to "HRMS" rather than to the platform operator's name: a message
 * whose sender cannot be established should be anonymous, not attributed to
 * whichever company happens to run the server.
 */
async function brandingFor(companyId: number | null): Promise<Branding> {
  if (companyId === null) return { companyName: process.env.SMTP_FROM_NAME || "HRMS" }
  try {
    return await withoutSession(async (client) => {
      const { rows } = await client.query<{ result: { company_name: string; logo_url: string | null } }>(
        "select public.get_email_branding($1) as result",
        [companyId]
      )
      const row = rows[0]?.result
      return { companyName: row?.company_name || "HRMS", logoUrl: row?.logo_url ?? null }
    })
  } catch {
    return { companyName: "HRMS" }
  }
}

// ------------------------------------------------------------------ logging
async function openLog(
  companyId: number | null,
  recipient: string,
  sender: string,
  subject: string,
  template?: string
): Promise<number | undefined> {
  try {
    return await withoutSession(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        "select public.log_email_attempt($1, $2, $3, $4, $5) as id",
        [companyId, recipient, sender, subject, template ?? null]
      )
      return rows[0]?.id
    })
  } catch (error) {
    // A log that cannot be written must not stop the mail. The alternative is
    // an outage in the audit trail becoming an outage in onboarding.
    console.error("[email] could not open log row:", (error as Error).message)
    return undefined
  }
}

async function closeLog(
  id: number | undefined,
  status: "sent" | "failed",
  messageId?: string,
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  if (id === undefined) return
  try {
    await withoutSession((client) =>
      client.query("select public.mark_email_result($1, $2, $3, $4, $5)", [
        id,
        status,
        messageId ?? null,
        errorCode ?? null,
        errorMessage ? errorMessage.slice(0, 1000) : null,
      ])
    )
  } catch (error) {
    console.error("[email] could not close log row:", (error as Error).message)
  }
}

async function recordFailure(
  companyId: number | null,
  recipient: string,
  sender: string,
  subject: string,
  template: string | undefined,
  code: string,
  message: string
): Promise<void> {
  const id = await openLog(companyId, recipient, sender, subject, template)
  await closeLog(id, "failed", undefined, code, scrubSecrets(message))
}

// -------------------------------------------------------------------- bulk
/**
 * Sends the same template to many people, one at a time, off the request.
 *
 * There is no Redis in this deployment, so this is not a queue — it is the
 * seam where one goes. `enqueueBulk` returns as soon as the work is accepted
 * and the sending continues in the background, which is the property that
 * matters to the caller: an announcement to 200 employees must not hold an
 * HTTP request open for two minutes, and must not fail the announcement if the
 * mail server is slow.
 *
 * When Redis arrives, the body of this function becomes a job push and nothing
 * that calls it has to change.
 */
export function enqueueBulk(params: {
  recipients: { email: string; data: TemplateData }[]
  template: TemplateName
  companyId: number | null
  /** Milliseconds between messages, to stay under a provider's rate limit. */
  spacingMs?: number
}): { accepted: number } {
  const valid = params.recipients.filter((r) => isValidAddress(r.email))
  const spacing = params.spacingMs ?? 250

  void (async () => {
    for (const recipient of valid) {
      try {
        await sendTemplateEmail({
          to: recipient.email,
          template: params.template,
          data: recipient.data,
          companyId: params.companyId,
        })
      } catch (error) {
        console.error("[email] bulk item failed:", scrubSecrets((error as Error).message))
      }
      if (spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing))
    }
  })()

  return { accepted: valid.length }
}

export { emailMode, appBaseUrl } from "./config.js"
export type { TemplateName } from "./templates.js"

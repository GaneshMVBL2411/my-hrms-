import crypto from "node:crypto"

/**
 * SMTP configuration, read from the environment and from nowhere else.
 *
 * Every value here is server-side. None of it is sent to a browser, written to
 * the database in plaintext, or included in an API response — the settings
 * screen shows a masked field and never receives the real one back.
 *
 * Two things are deliberate:
 *
 *   * `secure` is derived from the port unless it is set explicitly. 465 is
 *     implicit TLS and 587 is STARTTLS, and getting that pair the wrong way
 *     round is the single most common SMTP misconfiguration — it fails with a
 *     timeout or a protocol error that says nothing about the cause.
 *   * Missing configuration is not a startup error. An HRMS whose payroll and
 *     attendance stop working because a mail server is unreachable has traded
 *     a small problem for a large one; mail degrades, the rest carries on.
 */

export type EmailMode = "development" | "production"

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  fromEmail: string
  fromName: string
  replyTo?: string
}

/**
 * Whether real mail leaves this process.
 *
 * Defaults to development. The safe default is the one where an accidental
 * send does nothing — a test run against a production mailbox list cannot be
 * undone, and defaulting to "production" would make that the behaviour of an
 * unconfigured machine.
 */
export function emailMode(): EmailMode {
  const explicit = (process.env.EMAIL_MODE ?? "").trim().toLowerCase()
  if (explicit === "production") return "production"
  if (explicit === "development") return "development"
  return process.env.NODE_ENV === "production" ? "production" : "development"
}

/** 465 is implicit TLS; 587 and 25 are cleartext upgraded by STARTTLS. */
export function secureForPort(port: number, explicit?: string): boolean {
  if (explicit !== undefined && explicit !== "") {
    return explicit.trim().toLowerCase() === "true"
  }
  return port === 465
}

/**
 * The platform's own SMTP, used by every tenant that has not configured its
 * own. Returns null when it is not configured, which callers must handle
 * rather than treat as an error.
 */
export function platformSmtp(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST ?? "").trim()
  const fromEmail = (process.env.SMTP_FROM_EMAIL ?? "").trim()
  if (!host || !fromEmail) return null

  const port = Number(process.env.SMTP_PORT ?? 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null

  return {
    host,
    port,
    secure: secureForPort(port, process.env.SMTP_SECURE),
    user: (process.env.SMTP_USER ?? "").trim() || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    fromEmail,
    fromName: (process.env.SMTP_FROM_NAME ?? "HRMS").trim(),
    replyTo: (process.env.SMTP_REPLY_TO ?? "").trim() || undefined,
  }
}

/** Where links in emails point. Without it, no email containing a link is sent. */
export function appBaseUrl(): string | null {
  const raw = (process.env.APP_BASE_URL ?? "").trim()
  if (!raw) return null
  // Trailing slash removed once here rather than at every call site, where
  // forgetting produces a double slash that some mail clients will not linkify.
  return raw.replace(/\/+$/, "")
}

// ------------------------------------------------------- tenant credentials
/**
 * Encrypts a tenant's SMTP password for storage.
 *
 * AES-256-GCM with a random IV, and the auth tag kept alongside: the tag is
 * what makes this authenticated rather than merely scrambled, so a row edited
 * in the database fails to decrypt instead of yielding a different password.
 *
 * The key lives in EMAIL_ENCRYPTION_KEY, in the server's environment and
 * deliberately not in the database it protects. A stolen dump is then a table
 * of ciphertext rather than a list of working mail credentials.
 */
const KEY_BYTES = 32

function encryptionKey(): Buffer {
  const raw = (process.env.EMAIL_ENCRYPTION_KEY ?? "").trim()
  if (!raw) {
    throw new EmailConfigError(
      "EMAIL_ENCRYPTION_KEY is not set. Tenant SMTP passwords cannot be stored " +
        "without it. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    )
  }

  const key = Buffer.from(raw, "base64")
  if (key.length !== KEY_BYTES) {
    throw new EmailConfigError(
      `EMAIL_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}. ` +
        "It should be base64 of 32 random bytes."
    )
  }
  return key
}

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmailConfigError"
  }
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64. Versioned so the scheme can change. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    enc.toString("base64"),
  ].join(".")
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".")
  if (version !== "v1" || !iv || !tag || !data) {
    throw new EmailConfigError("Stored SMTP credential is not in a recognised format")
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64")
  )
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
    "utf8"
  )
}

/**
 * Strips anything that could be a credential from a value about to be logged.
 *
 * SMTP servers quote the failing command back in their error text, and a
 * failing AUTH command contains the base64 of the username and password. That
 * string then travels into an error log, and from there into wherever logs are
 * shipped — which is how mail credentials most often escape.
 */
export function scrubSecrets(text: string): string {
  let out = text
  for (const secret of [process.env.SMTP_PASSWORD, process.env.SMTP_USER]) {
    if (secret && secret.length > 3) out = out.split(secret).join("***")
  }
  // AUTH lines, and anything that looks like a credential pair in a URL.
  out = out.replace(/\bAUTH\s+(PLAIN|LOGIN|XOAUTH2)\s+\S+/gi, "AUTH $1 ***")
  out = out.replace(/(smtps?:\/\/[^:\s]+):[^@\s]+@/gi, "$1:***@")
  return out
}

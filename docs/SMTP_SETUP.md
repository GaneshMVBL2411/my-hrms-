# SMTP setup

How the HRMS sends email, how to configure it, and what to check when it does
not work.

---

## 1. Architecture

```
React web  ─┐
             ├─ HTTPS ─→  Node + Express  ─→  Email service  ─→  Nodemailer  ─→  SMTP  ─→  Inbox
React Native ┘                  │                    │
                                │                    ├─ email_logs        (what was attempted)
                                │                    ├─ audit_logs        (who asked for it)
                                └─ Postgres / Neon ───┘
```

Three things follow from this shape and are worth stating plainly.

**Only the backend ever holds SMTP credentials.** Not the React bundle, not the
mobile app, not the database in plaintext. A value in Vercel's environment ends
up in the browser bundle, which is why these variables belong on the backend
deployment alone.

**The mobile app never speaks SMTP.** It calls the same HRMS API the web app
does, and the API sends the mail. There is no path from a phone to a mail
server, by design — an app on someone's device is not a place to keep a
credential.

**A mail failure never fails the thing that triggered it.** Approving leave
writes to the database and *then* sends an email. If the mail server is down,
the approval still stands and the failure is recorded in `email_logs`. Every
event hook returns `void` and is called without `await`, which is what makes
that guarantee structural rather than a matter of care.

---

## 2. Environment variables

All of these go on the **backend** (Render or equivalent). None of them go on
Vercel.

| Variable | Required | Meaning |
|---|---|---|
| `SMTP_HOST` | to send at all | Mail server hostname. Leave empty to disable sending; the HRMS runs fine without it. |
| `SMTP_PORT` | no (587) | 587 for STARTTLS, 465 for implicit TLS. |
| `SMTP_SECURE` | no | Leave blank to derive from the port. Set `true`/`false` only if your provider is unusual. |
| `SMTP_USER` | usually | Username for the mail server. |
| `SMTP_PASSWORD` | usually | Password or app password. **Never commit this.** |
| `SMTP_FROM_EMAIL` | to send at all | The address mail comes from. |
| `SMTP_FROM_NAME` | no (`HRMS`) | Display name on the From header. |
| `SMTP_REPLY_TO` | no | Where employee replies should go. |
| `EMAIL_MODE` | no | `production` sends. Anything else logs and sends nothing. |
| `APP_BASE_URL` | for any email with a link | Where links point, e.g. `https://hrms.example.com`. Without it, emails needing a link are **not sent** rather than sent broken. |
| `EMAIL_ENCRYPTION_KEY` | for tenant SMTP | Base64 of 32 random bytes. Encrypts per-tenant SMTP passwords before storage. |

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep it **outside** the database it protects. That is the whole point: a stolen
database dump then contains ciphertext rather than working mail credentials.
Losing this key means every stored tenant SMTP password must be re-entered — it
cannot be recovered, and that is the intended trade.

`server/.env.example` lists all of these with empty values. Copy it to
`server/.env` and fill it in. `.env` is gitignored; keep it that way.

---

## 3. Port and TLS — get this pair right

This is the single most common SMTP misconfiguration, and it fails with a
timeout or a protocol error that says nothing about the cause.

| Port | `SMTP_SECURE` | What happens |
|---|---|---|
| 587 | `false` | Connection starts in clear, upgraded by STARTTLS. **The usual choice.** |
| 465 | `true` | TLS from the first byte. |
| 25 | `false` | Usually blocked by cloud providers. Avoid. |

Leave `SMTP_SECURE` blank and the server derives it: 465 → secure, everything
else → STARTTLS. On 587 the upgrade is **mandatory** (`requireTLS`), so a
server that does not offer STARTTLS fails rather than silently sending your
credentials in the clear.

---

## 4. Provider setup

### Gmail / Google Workspace

Ordinary account passwords will not work — you need an **app password**, and
that requires 2-step verification on the account.

1. Google Account → Security → 2-Step Verification (turn on).
2. Security → App passwords → generate one for "Mail".
3. Use the 16-character value as `SMTP_PASSWORD`, with no spaces.

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hr@yourdomain.com
SMTP_PASSWORD=<the 16-character app password>
SMTP_FROM_EMAIL=hr@yourdomain.com
```

Gmail rewrites the From header to the authenticated account, so
`SMTP_FROM_EMAIL` must match `SMTP_USER` or an alias configured on it. Free
Gmail also caps at roughly 500 messages a day, which an announcement to a large
company will exceed — use a real provider for that.

### Microsoft 365

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=hr@yourdomain.com
SMTP_PASSWORD=<account or app password>
```

Microsoft disables SMTP AUTH per-mailbox by default. If you get an
authentication failure with correct credentials, that is almost always why — an
administrator must enable "Authenticated SMTP" for the mailbox in the Microsoft
365 admin centre.

### SendGrid

The username is the literal string `apikey`. This surprises people.

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<your SendGrid API key>
SMTP_FROM_EMAIL=no-reply@yourdomain.com
```

The From address must be a verified sender or belong to an authenticated
domain, or SendGrid accepts the connection and drops the message.

### Amazon SES

Use **SMTP credentials**, not your AWS access keys — they are different things
and generated separately in the SES console.

```
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES SMTP username>
SMTP_PASSWORD=<SES SMTP password>
SMTP_FROM_EMAIL=no-reply@yourdomain.com
```

New SES accounts are in **sandbox mode** and can only send to verified
addresses. Request production access before going live, or your test to your own
address will work and every employee email will silently fail.

---

## 5. Development

```
EMAIL_MODE=development
```

Nothing is delivered. Each send is written to `email_logs` and one line goes to
the server log:

```
[email:dev] would send "Leave approved — Acme Ltd" to priya@example.com (template=leave_approved, company=1)
```

The metadata is logged; the body is not, because a rendered password-reset email
contains a working token and a terminal is not the place for it.

**Development is the default.** With `EMAIL_MODE` unset and `NODE_ENV` not
`production`, nothing is sent. An unconfigured machine cannot email real
employees by accident, which is the failure that cannot be undone.

To see real messages in development, run a local catcher and point at it:

```bash
docker run -p 1080:1080 -p 1025:1025 maildev/maildev
```

```
EMAIL_MODE=production
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM_EMAIL=dev@localhost
```

Never point a development machine at production SMTP credentials.

---

## 6. Production

**Backend (Render or equivalent)** — set every variable from section 2.
**Frontend (Vercel)** — set none of them. A variable there is in the bundle.

Before going live:

- [ ] `EMAIL_MODE=production`
- [ ] `APP_BASE_URL` is the real HTTPS origin, no trailing slash
- [ ] `EMAIL_ENCRYPTION_KEY` set, and backed up somewhere that is not the database
- [ ] SPF and DKIM published for the sending domain, or mail lands in spam
- [ ] The From address is verified with the provider
- [ ] Migration `0027_email_smtp.sql` applied
- [ ] `POST /admin/email/test` succeeds to a real mailbox

---

## 7. Testing SMTP

**From the portal:** Settings → Email / SMTP → *Test connection*, then
*Send test email*.

**From the API:**

```bash
curl -X POST https://your-api/admin/email/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

```json
{ "success": true, "message": "Test email sent successfully" }
```

Health check, admin-only:

```bash
curl https://your-api/admin/email/health -H "Authorization: Bearer <token>"
```

```json
{ "smtp": "connected", "mode": "production" }
```

The public `/health` endpoint deliberately says nothing about mail. An
unauthenticated caller learning which provider a company uses is free material
for whoever is writing the phishing email.

**Automated:** `npm test` in `server/` runs 23 email tests covering header
injection, credential leakage, cross-tenant access, template escaping and reset
token handling. None of them needs a live mail server.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `Email is not configured on this server` | `SMTP_HOST` or `SMTP_FROM_EMAIL` is empty. |
| `The mail server rejected the username or password` | Wrong credential — or, on Microsoft 365, SMTP AUTH disabled for the mailbox. On Gmail, an account password used where an app password is required. |
| `The mail server could not be reached` | Wrong host, or the platform blocks outbound SMTP. Render blocks port 25. |
| `The connection to the mail server timed out` | Almost always the port/TLS pair. 465 needs `secure=true`; 587 needs `false`. |
| Test succeeds, employees receive nothing | SES sandbox, or an unverified From address. Check `email_logs` for the real status. |
| Mail lands in spam | No SPF/DKIM for the sending domain. |
| Reset emails have no link | `APP_BASE_URL` is not set. The email is suppressed rather than sent broken; the server log says so. |
| Everything logs as `sent` but nothing arrives | `EMAIL_MODE` is not `production`. |

The detailed reason is always in the **server log**, scrubbed of credentials.
The API deliberately returns a short, safe message: `535 Authentication failed
for user hr@company.com` names the failure *and* confirms to whoever asked that
they have found a live mail configuration.

Delivery history: Settings → Email / SMTP, or `GET /admin/email/logs`.

---

## 9. Security notes

**What is enforced, and where.**

| Control | How |
|---|---|
| Credentials never reach a client | No API route returns a password. The settings reader returns `has_password: true/false` and nothing more. |
| Credentials never reach a log | Every error is passed through `scrubSecrets`, which strips the username, the password, quoted `AUTH` commands and credentials in URLs. |
| Tenant isolation | The company comes from the session, never from a request. `get_company_smtp_transport` refuses a company that is not the caller's. |
| No table path to settings | `company_email_settings` and `password_reset_tokens` have **no grant at all** to the application role. They cannot be reached through `/query` however its allow-lists change. |
| Sender cannot be chosen | `From` is built from configuration. `SendOptions` has no `from` field and no route reads one — an HRMS that let a caller pick the sender would be an open relay. |
| Header injection | CR, LF, NUL and Unicode line separators are refused in every header value. |
| Template injection | Every interpolated value is HTML-escaped; only `http(s)` URLs become links. |
| Passwords are never emailed | Onboarding sends a single-use activation link, not a credential. |
| Reset tokens | 32 random bytes; only the SHA-256 is stored; single-use; expiring; never logged or audited. |
| No account enumeration | `/auth/forgot-password` answers identically for a real address, an unknown one and a malformed one. |
| Rate limits | 5 test emails / 10 min; 5 reset requests / 15 min **per address**; 10 reset attempts / 15 min. |
| Audit | `email.settings_changed`, `email.test`, `email.bulk_initiated`, `email.payslip_sent`, `password.reset_requested`, `password.reset` — all raised server-side. |

**Payslips and documents are linked, not attached.** A PDF of someone's salary
in a mailbox is readable by anyone who later gains access to that mailbox, and
by every mail server in between. A link that requires signing in is not. The
templates say so explicitly, because an employee expecting an attachment will
otherwise assume the mail is broken.

**A note on the email log.** It records recipient, subject, template and status
— never a body. A log that stored message bodies would accumulate payslip
figures, reset links and personal notes in a table whose purpose is to be read
by an administrator debugging delivery, which is a worse breach surface than the
mail itself.

---

## 10. Per-tenant SMTP

Companies can send from their own mail server instead of the platform's:
Settings → Email / SMTP → *Use our own SMTP*.

Resolution order for any message:

1. The tenant's own settings, if configured **and** enabled.
2. Otherwise the platform's `SMTP_*` environment variables.

A tenant whose stored credential will not decrypt is **refused**, not quietly
fallen back to the platform transport — their mail would otherwise go out from
the wrong domain, which is worse than not going out.

Tenant passwords are AES-256-GCM encrypted with `EMAIL_ENCRYPTION_KEY` before
storage. GCM is authenticated, so a row edited in the database fails to decrypt
rather than yielding a different password.

---

## 11. Bulk email

Announcements go through `enqueueBulk`, which accepts the work and returns
immediately, then sends one message at a time with a small gap.

There is **no Redis in this deployment**, so this is not a real queue — it is
the seam where one goes. When Redis arrives, the body of `enqueueBulk` becomes a
job push and nothing that calls it has to change.

What it already guarantees: an announcement to 200 employees does not hold an
HTTP request open for a minute, and does not fail the announcement if the mail
server is slow.

What it does not: survive a process restart mid-send. If that matters before
Redis exists, `email_logs` records which messages were attempted.

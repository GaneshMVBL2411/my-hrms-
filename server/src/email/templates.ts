/**
 * The HRMS's email templates.
 *
 * Every one takes the company name as data. None of them contains it. This is
 * a multi-tenant platform, and a template that knew a company name of its own
 * would eventually send "Whhoohh Path LLP" to a customer's employees — a
 * mistake that is invisible in testing, because in testing there is only one
 * tenant.
 *
 * Everything interpolated goes through `esc`. These are HTML documents built
 * from names, task titles and reasons that people typed, and a template that
 * concatenated them raw would let a leave reason close a tag and rewrite the
 * rest of the mail — including the link the recipient is being asked to click.
 *
 * Each template returns a plain-text part as well. It is not a courtesy: mail
 * that arrives as HTML only scores worse with spam filters, and some clients
 * show nothing at all.
 */

export type TemplateName =
  | "welcome_employee"
  | "employee_account_created"
  | "password_reset"
  | "leave_submitted"
  | "leave_submitted_approver"
  | "leave_approved"
  | "leave_rejected"
  | "attendance_notification"
  | "payslip_generated"
  | "payroll_processed"
  | "task_assigned"
  | "task_completed"
  | "project_assignment"
  | "announcement"
  | "document_shared"
  | "employee_offboarding"
  | "hrms_invitation"
  | "smtp_test"

export interface Branding {
  companyName: string
  logoUrl?: string | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** HTML-escapes a value for interpolation into a template. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Only http(s) links are allowed through, and everything else becomes "#".
 *
 * Templates take URLs from configuration rather than from users, so this is a
 * belt on top of braces — but `javascript:` and `data:` in an href are a real
 * class of bug, and the check costs one function call.
 */
function safeUrl(url: string | null | undefined): string {
  if (!url) return "#"
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? esc(url) : "#"
  } catch {
    return "#"
  }
}

// ------------------------------------------------------------------- layout
const BRAND_INK = "#0f4c34"

/**
 * One frame around every message.
 *
 * Tables and inline styles rather than modern CSS: Outlook still renders mail
 * with Word's engine, which supports neither flexbox nor grid, and a layout
 * that looks correct everywhere else collapses there.
 */
function layout(branding: Branding, heading: string, body: string, footerNote?: string): string {
  const company = esc(branding.companyName || "HRMS")
  const logo = branding.logoUrl
    ? `<img src="${safeUrl(branding.logoUrl)}" alt="${company}" height="36" style="display:block;border:0;max-height:36px" />`
    : `<span style="font:600 18px/1.2 Segoe UI,Arial,sans-serif;color:#ffffff">${company}</span>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td style="background:${BRAND_INK};padding:18px 24px">${logo}</td></tr>
  <tr><td style="padding:28px 24px 8px">
    <h1 style="margin:0 0 14px;font:600 20px/1.3 Segoe UI,Arial,sans-serif;color:#0f172a">${esc(heading)}</h1>
    <div style="font:400 15px/1.6 Segoe UI,Arial,sans-serif;color:#334155">${body}</div>
  </td></tr>
  <tr><td style="padding:20px 24px 26px">
    <p style="margin:0;font:400 12px/1.5 Segoe UI,Arial,sans-serif;color:#94a3b8">
      ${footerNote ? esc(footerNote) + "<br />" : ""}
      This message was sent by ${company} HR. Please do not reply to this address.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0">
<tr><td style="background:${BRAND_INK};border-radius:8px">
<a href="${safeUrl(url)}" style="display:inline-block;padding:12px 22px;font:600 15px/1 Segoe UI,Arial,sans-serif;color:#ffffff;text-decoration:none">${esc(label)}</a>
</td></tr></table>`
}

/** A label/value list — the shape most of these emails actually are. */
function facts(rows: [string, unknown][]): string {
  const cells = rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 14px 6px 0;font:400 14px/1.5 Segoe UI,Arial,sans-serif;color:#64748b;white-space:nowrap">${esc(k)}</td>
             <td style="padding:6px 0;font:600 14px/1.5 Segoe UI,Arial,sans-serif;color:#0f172a">${esc(v)}</td></tr>`
    )
    .join("")
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 4px">${cells}</table>`
}

/** The plain-text alternative: the same content, without the frame. */
function plain(heading: string, lines: (string | null | undefined)[], company: string): string {
  return [heading, "", ...lines.filter((l): l is string => Boolean(l && l.trim())), "", `— ${company} HR`]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

// ---------------------------------------------------------------- templates
export interface TemplateData {
  [key: string]: unknown
}

type Renderer = (d: TemplateData, b: Branding) => RenderedEmail

const s = (d: TemplateData, key: string): string => (d[key] === undefined || d[key] === null ? "" : String(d[key]))

const TEMPLATES: Record<TemplateName, Renderer> = {
  // 1 ----------------------------------------------------------------------
  welcome_employee: (d, b) => {
    const heading = `Welcome to ${b.companyName}`
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">Your account on the ${esc(b.companyName)} HR portal is ready. You can view your attendance, apply for leave, and read your payslips there.</p>
${facts([["Employee ID", s(d, "employeeCode")], ["Designation", s(d, "designation")], ["Department", s(d, "department")], ["Joining date", s(d, "joiningDate")]])}
<p style="margin:12px 0 0">To get started, set your password using the button below. The link is valid for a limited time and can be used once.</p>
${button("Set your password", s(d, "actionUrl"))}
<p style="margin:0;font-size:13px;color:#64748b">If the button does not work, copy this link into your browser:<br />${esc(s(d, "actionUrl"))}</p>`
    return {
      subject: heading,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `Your account on the ${b.companyName} HR portal is ready.`,
        s(d, "employeeCode") ? `Employee ID: ${s(d, "employeeCode")}` : null,
        `Set your password: ${s(d, "actionUrl")}`,
        "This link can be used once and expires.",
      ], b.companyName),
    }
  },

  // 2 ----------------------------------------------------------------------
  employee_account_created: (d, b) => {
    const heading = "An HRMS account has been created for you"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">${esc(s(d, "createdByName") || "Your HR team")} has created an HRMS account for you at ${esc(b.companyName)}.</p>
${facts([["Employee ID", s(d, "employeeCode")], ["Sign-in address", s(d, "email")], ["Role", s(d, "role")]])}
${button("Activate your account", s(d, "actionUrl"))}
<p style="margin:0;font-size:13px;color:#64748b">For your security this email contains no password. Use the link above to choose your own.</p>`
    return {
      subject: `${heading} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `An HRMS account has been created for you at ${b.companyName}.`,
        `Sign-in address: ${s(d, "email")}`,
        `Activate your account: ${s(d, "actionUrl")}`,
        "This email contains no password by design.",
      ], b.companyName),
    }
  },

  // 3 ----------------------------------------------------------------------
  password_reset: (d, b) => {
    const heading = "Reset your password"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName") || "there")},</p>
<p style="margin:0 0 6px">Someone asked to reset the password for your ${esc(b.companyName)} HRMS account. If that was you, use the button below.</p>
${button("Reset password", s(d, "actionUrl"))}
<p style="margin:0 0 6px;font-size:13px;color:#64748b">This link expires in ${esc(s(d, "expiryMinutes") || "30")} minutes and can be used once.</p>
<p style="margin:12px 0 0;font-size:13px;color:#64748b">If you did not ask for this, you can ignore this email — your password will not change. Resetting a password signs out every device currently signed in.</p>`
    return {
      subject: `Reset your ${b.companyName} HRMS password`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Someone asked to reset the password for your ${b.companyName} HRMS account.`,
        `Reset it here: ${s(d, "actionUrl")}`,
        `This link expires in ${s(d, "expiryMinutes") || "30"} minutes and can be used once.`,
        "If this was not you, ignore this email — nothing will change.",
      ], b.companyName),
    }
  },

  // 4 ----------------------------------------------------------------------
  leave_submitted: (d, b) => {
    const heading = "Your leave request has been submitted"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">We have received your leave request. You will be emailed again once it has been decided.</p>
${facts([["Type", s(d, "leaveType")], ["From", s(d, "startDate")], ["To", s(d, "endDate")], ["Days", s(d, "days")], ["Reason", s(d, "reason")]])}
${s(d, "actionUrl") ? button("View your requests", s(d, "actionUrl")) : ""}`
    return {
      subject: `Leave request submitted — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `${s(d, "leaveType")}: ${s(d, "startDate")} to ${s(d, "endDate")} (${s(d, "days")} day(s))`,
        "You will be emailed again once it has been decided.",
      ], b.companyName),
    }
  },

  // 5 ----------------------------------------------------------------------
  leave_submitted_approver: (d, b) => {
    const heading = "A leave request needs your approval"
    const body = `<p style="margin:0 0 6px">${esc(s(d, "employeeName"))} has requested leave.</p>
${facts([["Employee", s(d, "employeeName")], ["Employee ID", s(d, "employeeCode")], ["Type", s(d, "leaveType")], ["From", s(d, "startDate")], ["To", s(d, "endDate")], ["Days", s(d, "days")], ["Reason", s(d, "reason")]])}
${s(d, "actionUrl") ? button("Review the request", s(d, "actionUrl")) : ""}`
    return {
      subject: `Leave approval needed: ${s(d, "employeeName")} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `${s(d, "employeeName")} has requested leave.`,
        `${s(d, "leaveType")}: ${s(d, "startDate")} to ${s(d, "endDate")} (${s(d, "days")} day(s))`,
        s(d, "reason") ? `Reason: ${s(d, "reason")}` : null,
        s(d, "actionUrl") ? `Review: ${s(d, "actionUrl")}` : null,
      ], b.companyName),
    }
  },

  // 6 ----------------------------------------------------------------------
  leave_approved: (d, b) => {
    const heading = "Your leave has been approved"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">Your leave request has been approved${s(d, "decidedBy") ? ` by ${esc(s(d, "decidedBy"))}` : ""}.</p>
${facts([["Type", s(d, "leaveType")], ["From", s(d, "startDate")], ["To", s(d, "endDate")], ["Days", s(d, "days")]])}
${s(d, "decisionNote") ? `<p style="margin:12px 0 0;padding:12px 14px;background:#f1f5f9;border-radius:8px"><strong style="color:#0f172a">Note from HR:</strong><br />${esc(s(d, "decisionNote"))}</p>` : ""}
${s(d, "actionUrl") ? button("View your requests", s(d, "actionUrl")) : ""}`
    return {
      subject: `Leave approved — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `Your leave request has been approved${s(d, "decidedBy") ? ` by ${s(d, "decidedBy")}` : ""}.`,
        `${s(d, "leaveType")}: ${s(d, "startDate")} to ${s(d, "endDate")} (${s(d, "days")} day(s))`,
        s(d, "decisionNote") ? `Note from HR: ${s(d, "decisionNote")}` : null,
      ], b.companyName),
    }
  },

  // 7 ----------------------------------------------------------------------
  leave_rejected: (d, b) => {
    const heading = "Your leave request was not approved"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">Your leave request has not been approved${s(d, "decidedBy") ? ` by ${esc(s(d, "decidedBy"))}` : ""}.</p>
${facts([["Type", s(d, "leaveType")], ["From", s(d, "startDate")], ["To", s(d, "endDate")], ["Days", s(d, "days")]])}
${s(d, "decisionNote") ? `<p style="margin:12px 0 0;padding:12px 14px;background:#fef3c7;border-radius:8px"><strong style="color:#0f172a">Reason given:</strong><br />${esc(s(d, "decisionNote"))}</p>` : ""}
<p style="margin:14px 0 0">If you would like to discuss this, reply to your HR team through the portal.</p>
${s(d, "actionUrl") ? button("View your requests", s(d, "actionUrl")) : ""}`
    return {
      subject: `Leave request not approved — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `Your leave request has not been approved${s(d, "decidedBy") ? ` by ${s(d, "decidedBy")}` : ""}.`,
        `${s(d, "leaveType")}: ${s(d, "startDate")} to ${s(d, "endDate")} (${s(d, "days")} day(s))`,
        s(d, "decisionNote") ? `Reason given: ${s(d, "decisionNote")}` : null,
      ], b.companyName),
    }
  },

  // 8 ----------------------------------------------------------------------
  attendance_notification: (d, b) => {
    const heading = esc(s(d, "title")) || "Attendance update"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">${esc(s(d, "message"))}</p>
${facts([["Date", s(d, "date")], ["Checked in", s(d, "checkIn")], ["Checked out", s(d, "checkOut")], ["Status", s(d, "status")]])}
${s(d, "actionUrl") ? button("View attendance", s(d, "actionUrl")) : ""}`
    return {
      subject: `${s(d, "title") || "Attendance update"} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [`Hello ${s(d, "employeeName")},`, s(d, "message"), `Date: ${s(d, "date")}`], b.companyName),
    }
  },

  // 9 ----------------------------------------------------------------------
  payslip_generated: (d, b) => {
    const heading = `Your ${s(d, "period")} payslip is ready`
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">Your payslip for ${esc(s(d, "period"))} has been generated and is available in the HR portal.</p>
${button("View payslip", s(d, "actionUrl"))}
<p style="margin:0;font-size:13px;color:#64748b">The payslip is not attached to this email. You will need to sign in to view it, which keeps your salary details out of your mailbox and out of anyone else's.</p>`
    return {
      subject: `Your ${s(d, "period")} payslip — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `Your payslip for ${s(d, "period")} is ready.`,
        `View it here: ${s(d, "actionUrl")}`,
        "It is not attached: you will need to sign in to view it.",
      ], b.companyName),
    }
  },

  // 10 ---------------------------------------------------------------------
  payroll_processed: (d, b) => {
    const heading = `Payroll for ${s(d, "period")} has been processed`
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "recipientName") || "there")},</p>
<p style="margin:0 0 6px">The payroll run for ${esc(s(d, "period"))} is complete.</p>
${facts([["Period", s(d, "period")], ["Employees paid", s(d, "employeeCount")], ["Processed by", s(d, "processedBy")]])}
${s(d, "actionUrl") ? button("Open payroll", s(d, "actionUrl")) : ""}
<p style="margin:0;font-size:13px;color:#64748b">Individual salary figures are not included in this email.</p>`
    return {
      subject: `Payroll processed for ${s(d, "period")} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `The payroll run for ${s(d, "period")} is complete.`,
        `Employees paid: ${s(d, "employeeCount")}`,
      ], b.companyName),
    }
  },

  // 11 ---------------------------------------------------------------------
  task_assigned: (d, b) => {
    const heading = "A task has been assigned to you"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">${esc(s(d, "assignedByName") || "Your manager")} has assigned you a task.</p>
${facts([["Task", s(d, "taskTitle")], ["Project", s(d, "projectName")], ["Due", s(d, "dueDate")], ["Priority", s(d, "priority")]])}
${s(d, "actionUrl") ? button("Open the task", s(d, "actionUrl")) : ""}`
    return {
      subject: `New task: ${s(d, "taskTitle")} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `Task: ${s(d, "taskTitle")}`,
        s(d, "projectName") ? `Project: ${s(d, "projectName")}` : null,
        s(d, "dueDate") ? `Due: ${s(d, "dueDate")}` : null,
        s(d, "actionUrl") ? `Open: ${s(d, "actionUrl")}` : null,
      ], b.companyName),
    }
  },

  // 12 ---------------------------------------------------------------------
  task_completed: (d, b) => {
    const heading = "A task has been completed"
    const body = `<p style="margin:0 0 6px">${esc(s(d, "completedByName"))} has marked a task as complete.</p>
${facts([["Task", s(d, "taskTitle")], ["Project", s(d, "projectName")], ["Completed by", s(d, "completedByName")], ["Completed on", s(d, "completedAt")]])}
${s(d, "actionUrl") ? button("Open the task", s(d, "actionUrl")) : ""}`
    return {
      subject: `Task completed: ${s(d, "taskTitle")} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [`${s(d, "completedByName")} completed: ${s(d, "taskTitle")}`], b.companyName),
    }
  },

  // 13 ---------------------------------------------------------------------
  project_assignment: (d, b) => {
    const heading = "You have been added to a project"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">You have been added to a project at ${esc(b.companyName)}.</p>
${facts([["Project", s(d, "projectName")], ["Your role", s(d, "roleInProject")], ["Deadline", s(d, "deadline")]])}
${s(d, "actionUrl") ? button("Open the project", s(d, "actionUrl")) : ""}`
    return {
      subject: `Added to project: ${s(d, "projectName")} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [`You have been added to ${s(d, "projectName")}.`], b.companyName),
    }
  },

  // 14 ---------------------------------------------------------------------
  announcement: (d, b) => {
    const heading = s(d, "title") || "Announcement"
    // The body is the one place a template renders authored prose. It is still
    // escaped: HR writing an announcement is trusted to be honest, not trusted
    // to be a safe HTML author, and paragraph breaks are all that is needed.
    const paragraphs = s(d, "body")
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 10px">${esc(p).replace(/\n/g, "<br />")}</p>`)
      .join("")
    const body = `${paragraphs}
${s(d, "postedBy") ? `<p style="margin:14px 0 0;font-size:13px;color:#64748b">Posted by ${esc(s(d, "postedBy"))}</p>` : ""}
${s(d, "actionUrl") ? button("Read in the portal", s(d, "actionUrl")) : ""}`
    return {
      subject: `${heading} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [s(d, "body"), s(d, "postedBy") ? `Posted by ${s(d, "postedBy")}` : null], b.companyName),
    }
  },

  // 15 ---------------------------------------------------------------------
  document_shared: (d, b) => {
    const heading = "A document has been shared with you"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">${esc(s(d, "sharedByName") || "Your HR team")} has shared a document with you.</p>
${facts([["Document", s(d, "documentName")], ["Type", s(d, "documentType")], ["Shared on", s(d, "sharedAt")]])}
${button("Open the document", s(d, "actionUrl"))}
<p style="margin:0;font-size:13px;color:#64748b">The document is not attached. You will need to sign in to open it.</p>`
    return {
      subject: `Document shared: ${s(d, "documentName")} — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `${s(d, "sharedByName") || "Your HR team"} shared "${s(d, "documentName")}" with you.`,
        `Open it here: ${s(d, "actionUrl")}`,
      ], b.companyName),
    }
  },

  // 16 ---------------------------------------------------------------------
  employee_offboarding: (d, b) => {
    const heading = "Your last working day"
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName"))},</p>
<p style="margin:0 0 6px">This is a note about the end of your time at ${esc(b.companyName)}. Thank you for your work.</p>
${facts([["Last working day", s(d, "lastWorkingDay")], ["Employee ID", s(d, "employeeCode")]])}
<p style="margin:12px 0 0">Your portal access will end after your last working day. Please download anything you need — payslips and letters — before then.</p>
${s(d, "actionUrl") ? button("Open the portal", s(d, "actionUrl")) : ""}
<p style="margin:10px 0 0;font-size:13px;color:#64748b">If anything here is wrong, contact your HR team.</p>`
    return {
      subject: `Your last working day at ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `Hello ${s(d, "employeeName")},`,
        `Last working day: ${s(d, "lastWorkingDay")}`,
        "Portal access ends after that date — please download your payslips and letters before then.",
      ], b.companyName),
    }
  },

  // 17 ---------------------------------------------------------------------
  hrms_invitation: (d, b) => {
    const heading = `You have been invited to ${b.companyName}`
    const body = `<p style="margin:0 0 6px">Hello ${esc(s(d, "employeeName") || "there")},</p>
<p style="margin:0 0 6px">${esc(s(d, "invitedByName") || "An administrator")} has invited you to the ${esc(b.companyName)} HR portal.</p>
${facts([["Sign-in address", s(d, "email")], ["Role", s(d, "role")], ["Invitation expires", s(d, "expiresAt")]])}
${button("Accept the invitation", s(d, "actionUrl"))}
<p style="margin:0;font-size:13px;color:#64748b">If you were not expecting this, you can ignore it — nothing happens until you accept.</p>`
    return {
      subject: `Invitation to ${b.companyName} HRMS`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `${s(d, "invitedByName") || "An administrator"} has invited you to the ${b.companyName} HR portal.`,
        `Accept: ${s(d, "actionUrl")}`,
      ], b.companyName),
    }
  },

  // 18 ---------------------------------------------------------------------
  smtp_test: (d, b) => {
    const heading = "SMTP test successful"
    const body = `<p style="margin:0 0 6px">This is a test message from the ${esc(b.companyName)} HRMS.</p>
<p style="margin:0 0 6px">If you are reading it, the mail server settings are working and the HRMS can send email.</p>
${facts([["Sent at", s(d, "sentAt")], ["Requested by", s(d, "requestedBy")], ["Environment", s(d, "environment")]])}
<p style="margin:12px 0 0;font-size:13px;color:#64748b">No credentials are included in this message.</p>`
    return {
      subject: `HRMS SMTP test — ${b.companyName}`,
      html: layout(b, heading, body),
      text: plain(heading, [
        `This is a test message from the ${b.companyName} HRMS.`,
        "If you are reading it, the mail server settings are working.",
        `Sent at: ${s(d, "sentAt")}`,
      ], b.companyName),
    }
  },
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[]

export function isTemplateName(name: unknown): name is TemplateName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(TEMPLATES, name)
}

/**
 * Renders one template.
 *
 * Throws on an unknown name rather than falling back to a generic message: a
 * typo'd template name should fail loudly in a test, not send something
 * half-blank to an employee.
 */
export function render(name: TemplateName, data: TemplateData, branding: Branding): RenderedEmail {
  const renderer = TEMPLATES[name]
  if (!renderer) throw new Error(`Unknown email template: ${name}`)
  return renderer(data, { companyName: branding.companyName || "HRMS", logoUrl: branding.logoUrl })
}

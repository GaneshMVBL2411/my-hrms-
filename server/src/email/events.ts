import crypto from "node:crypto"
import { withoutSession } from "../db.js"
import { logSecurityEvent } from "../security.js"
import { appBaseUrl } from "./config.js"
import { enqueueBulk, sendTemplateEmail } from "./index.js"
import type { TemplateData } from "./templates.js"

/**
 * HRMS events, translated into email.
 *
 * Everything here is fire-and-forget by design. An email is a notification
 * *about* something that already happened — the leave is approved, the payslip
 * is generated, the employee exists — and none of those may be undone because
 * a mail server is slow or down. So every function returns void, catches its
 * own failures, and is called without being awaited.
 *
 * That is also why none of this lives inside the database functions. A trigger
 * that sent mail would put SMTP inside the transaction that writes payroll,
 * and a timeout there would roll back the payroll.
 */

/** Runs the send without making the caller wait or care. */
function fireAndForget(what: string, run: () => Promise<unknown>): void {
  void run().catch((error: Error) => {
    // Logged, not thrown. The HRMS action already succeeded.
    console.error(`[email:event] ${what} failed:`, error.message)
  })
}

interface Recipient {
  email: string
  fullName: string
  companyId: number | null
}

/** Looks up who to write to. Runs without a session: this is server-initiated. */
async function employeeRecipient(employeeId: number): Promise<Recipient | null> {
  try {
    return await withoutSession(async (client) => {
      const { rows } = await client.query<{
        email: string
        full_name: string
        company_id: number
      }>(
        `select u.email, e.full_name, e.company_id
           from public.employees e
           join public.users u on u.id = e.user_id
          where e.id = $1 and u.is_active
          limit 1`,
        [employeeId]
      )
      const row = rows[0]
      return row ? { email: row.email, fullName: row.full_name, companyId: row.company_id } : null
    })
  } catch (error) {
    console.error("[email:event] recipient lookup failed:", (error as Error).message)
    return null
  }
}

/** Everyone at this company who decides leave — the approval queue's audience. */
async function approvers(companyId: number): Promise<Recipient[]> {
  try {
    return await withoutSession(async (client) => {
      const { rows } = await client.query<{ email: string; full_name: string }>(
        `select u.email, coalesce(e.full_name, u.email) as full_name
           from public.users u
           join public.roles r on r.id = u.role_id
           left join public.employees e on e.user_id = u.id
          where u.company_id = $1
            and u.is_active
            and r.name in ('founder', 'company_admin', 'hr_admin')`,
        [companyId]
      )
      return rows.map((r) => ({ email: r.email, fullName: r.full_name, companyId }))
    })
  } catch (error) {
    console.error("[email:event] approver lookup failed:", (error as Error).message)
    return []
  }
}

// ------------------------------------------------------------- onboarding
/**
 * A new employee has been created.
 *
 * Sends an activation link rather than a password. The HRMS does create an
 * initial credential, and mailing it would put a working password into an
 * inbox, a mail server's spool and every backup of both — where it stays
 * readable long after the employee has changed it.
 *
 * The link is a password-reset token under a different name, which is the
 * right shape: single use, time limited, and it proves the person controls the
 * address before it lets them set anything.
 */
export function onEmployeeCreated(params: {
  employeeId: number
  email: string
  fullName: string
  employeeCode?: string | null
  companyId: number
  createdByName?: string
  role?: string
}): void {
  fireAndForget("employee_created", async () => {
    const base = appBaseUrl()
    let actionUrl: string | undefined

    if (base) {
      const token = crypto.randomBytes(32).toString("base64url")
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
      // A longer window than a reset: a welcome email may arrive while someone
      // is still on gardening leave, and a link that expires in half an hour
      // guarantees a support ticket on day one.
      const found = await withoutSession(async (client) => {
        const { rows } = await client.query(
          "select * from public.create_password_reset($1, $2, $3, $4)",
          [params.email, tokenHash, 60 * 24 * 7, null]
        )
        return rows[0] ?? null
      })
      if (found) actionUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`
    }

    await sendTemplateEmail({
      to: params.email,
      template: "welcome_employee",
      companyId: params.companyId,
      data: {
        employeeName: params.fullName,
        employeeCode: params.employeeCode ?? "",
        role: params.role ?? "",
        email: params.email,
        createdByName: params.createdByName ?? "",
        actionUrl: actionUrl ?? "",
      },
    })

    await logSecurityEvent(
      "email.welcome_sent",
      "employees",
      params.employeeId,
      { recipient: params.email.toLowerCase() },
      undefined,
      undefined,
      "success"
    )
  })
}

// ------------------------------------------------------------------ leave
/** A leave request has been made: confirm to the employee, alert the approvers. */
export function onLeaveSubmitted(params: {
  requestId: number
  employeeId: number
  companyId: number
  leaveType: string
  startDate: string
  endDate: string
  days: number | string
  reason?: string | null
}): void {
  fireAndForget("leave_submitted", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    const shared: TemplateData = {
      employeeName: employee.fullName,
      leaveType: params.leaveType,
      startDate: params.startDate,
      endDate: params.endDate,
      days: params.days,
      reason: params.reason ?? "",
      path: "/leaves",
    }

    await sendTemplateEmail({
      to: employee.email,
      template: "leave_submitted",
      companyId: params.companyId,
      data: shared,
    })

    const toApprovers = await approvers(params.companyId)
    if (toApprovers.length > 0) {
      enqueueBulk({
        recipients: toApprovers.map((a) => ({ email: a.email, data: shared })),
        template: "leave_submitted_approver",
        companyId: params.companyId,
      })
    }
  })
}

/** A leave request has been decided. The note HR wrote travels with it. */
export function onLeaveDecided(params: {
  requestId: number
  employeeId: number
  companyId: number
  approved: boolean
  leaveType: string
  startDate: string
  endDate: string
  days: number | string
  decisionNote?: string | null
  decidedBy?: string
}): void {
  fireAndForget("leave_decided", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: params.approved ? "leave_approved" : "leave_rejected",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        leaveType: params.leaveType,
        startDate: params.startDate,
        endDate: params.endDate,
        days: params.days,
        decisionNote: params.decisionNote ?? "",
        decidedBy: params.decidedBy ?? "",
        path: "/leaves",
      },
    })
  })
}

// ---------------------------------------------------------------- payroll
/**
 * A payslip is ready.
 *
 * The payslip itself is not attached. A PDF of someone's salary sitting in a
 * mailbox is readable by anyone who later gains access to that mailbox, and by
 * every mail server between here and there; a link that requires signing in is
 * not. The template says so explicitly, because an employee expecting an
 * attachment will otherwise assume the mail is broken.
 */
export function onPayslipGenerated(params: {
  payslipId: number
  employeeId: number
  companyId: number
  period: string
}): void {
  fireAndForget("payslip_generated", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: "payslip_generated",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        period: params.period,
        path: `/payroll?payslip=${params.payslipId}`,
      },
    })

    await logSecurityEvent(
      "email.payslip_sent",
      "payslips",
      params.payslipId,
      { employee_id: params.employeeId },
      undefined,
      undefined,
      "success"
    )
  })
}

/** A payroll run is finished — a summary for whoever ran it, with no figures. */
export function onPayrollProcessed(params: {
  companyId: number
  period: string
  employeeCount: number
  processedBy: string
  notify: string[]
}): void {
  fireAndForget("payroll_processed", async () => {
    const recipients = params.notify.filter(Boolean)
    if (recipients.length === 0) return

    enqueueBulk({
      recipients: recipients.map((email) => ({
        email,
        data: {
          period: params.period,
          employeeCount: params.employeeCount,
          processedBy: params.processedBy,
          path: "/payroll",
        },
      })),
      template: "payroll_processed",
      companyId: params.companyId,
    })
  })
}

// ------------------------------------------------------------------ tasks
export function onTaskAssigned(params: {
  taskId: number
  employeeId: number
  companyId: number
  taskTitle: string
  projectName?: string | null
  dueDate?: string | null
  priority?: string | null
  assignedByName?: string
}): void {
  fireAndForget("task_assigned", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: "task_assigned",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        taskTitle: params.taskTitle,
        projectName: params.projectName ?? "",
        dueDate: params.dueDate ?? "",
        priority: params.priority ?? "",
        assignedByName: params.assignedByName ?? "",
        path: `/tasks?task=${params.taskId}`,
      },
    })
  })
}

export function onTaskCompleted(params: {
  taskId: number
  companyId: number
  taskTitle: string
  projectName?: string | null
  completedByName: string
  notify: string[]
}): void {
  fireAndForget("task_completed", async () => {
    const recipients = params.notify.filter(Boolean)
    if (recipients.length === 0) return

    enqueueBulk({
      recipients: recipients.map((email) => ({
        email,
        data: {
          taskTitle: params.taskTitle,
          projectName: params.projectName ?? "",
          completedByName: params.completedByName,
          completedAt: new Date().toISOString().slice(0, 10),
          path: `/tasks?task=${params.taskId}`,
        },
      })),
      template: "task_completed",
      companyId: params.companyId,
    })
  })
}

export function onProjectAssignment(params: {
  projectId: number
  employeeId: number
  companyId: number
  projectName: string
  roleInProject?: string | null
  deadline?: string | null
}): void {
  fireAndForget("project_assignment", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: "project_assignment",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        projectName: params.projectName,
        roleInProject: params.roleInProject ?? "",
        deadline: params.deadline ?? "",
        path: `/projects/${params.projectId}`,
      },
    })
  })
}

// ---------------------------------------------------------- announcements
/**
 * An announcement, to everyone at the company.
 *
 * Goes through the bulk path, which returns as soon as the work is accepted.
 * Two hundred employees at a quarter-second apart is close to a minute of
 * sending, and an HTTP request held open that long will be abandoned by a
 * browser, a load balancer, or both — and the announcement would then appear
 * to have failed while the mail was still going out.
 */
export function onAnnouncementPublished(params: {
  announcementId: number
  companyId: number
  title: string
  body: string
  postedBy?: string
}): void {
  fireAndForget("announcement", async () => {
    const audience = await withoutSession(async (client) => {
      const { rows } = await client.query<{ email: string }>(
        `select u.email
           from public.users u
          where u.company_id = $1 and u.is_active`,
        [params.companyId]
      )
      return rows.map((r) => r.email)
    })

    const { accepted } = enqueueBulk({
      recipients: audience.map((email) => ({
        email,
        data: {
          title: params.title,
          body: params.body,
          postedBy: params.postedBy ?? "",
          path: "/announcements",
        },
      })),
      template: "announcement",
      companyId: params.companyId,
    })

    await logSecurityEvent(
      "email.bulk_initiated",
      "announcements",
      params.announcementId,
      { recipients: accepted, template: "announcement" },
      undefined,
      undefined,
      "success"
    )
  })
}

// -------------------------------------------------------------- documents
export function onDocumentShared(params: {
  documentId: number
  employeeId: number
  companyId: number
  documentName: string
  documentType?: string | null
  sharedByName?: string
}): void {
  fireAndForget("document_shared", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: "document_shared",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        documentName: params.documentName,
        documentType: params.documentType ?? "",
        sharedByName: params.sharedByName ?? "",
        sharedAt: new Date().toISOString().slice(0, 10),
        path: `/documents?doc=${params.documentId}`,
      },
    })
  })
}

// ------------------------------------------------------------- offboarding
export function onEmployeeOffboarding(params: {
  employeeId: number
  companyId: number
  lastWorkingDay: string
  employeeCode?: string | null
}): void {
  fireAndForget("employee_offboarding", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: "employee_offboarding",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        employeeCode: params.employeeCode ?? "",
        lastWorkingDay: params.lastWorkingDay,
        path: "/documents",
      },
    })
  })
}

// -------------------------------------------------------------- attendance
export function onAttendanceNotification(params: {
  employeeId: number
  companyId: number
  title: string
  message: string
  date: string
  checkIn?: string | null
  checkOut?: string | null
  status?: string | null
}): void {
  fireAndForget("attendance_notification", async () => {
    const employee = await employeeRecipient(params.employeeId)
    if (!employee) return

    await sendTemplateEmail({
      to: employee.email,
      template: "attendance_notification",
      companyId: params.companyId,
      data: {
        employeeName: employee.fullName,
        title: params.title,
        message: params.message,
        date: params.date,
        checkIn: params.checkIn ?? "",
        checkOut: params.checkOut ?? "",
        status: params.status ?? "",
        path: "/attendance",
      },
    })
  })
}

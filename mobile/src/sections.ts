import { decideLeave, updateTask, type SelectOptions } from "./api"
import { LETTER_TITLES } from "./letters"
import type { MotionName } from "./motion"

/**
 * The HRMS sections that exist natively, described rather than written out.
 *
 * Ten screens whose only real differences are which collection they read and
 * how a row reads on a phone. Written as five components they would be five
 * copies of the same list, fetch, empty state, error state and pull-to-refresh
 * — and a fix to any of that would have to be made ten times. So each is a
 * config and <ListScreen> renders all of them.
 *
 * A row is deliberately flattened to four slots. A phone has room for a line, a
 * quieter line beneath it, something short on the right, and a status — beyond
 * that a list stops being scannable, whatever the table behind it holds.
 *
 * These read the same collections as the web app through the same endpoint, so
 * row level security decides what comes back in exactly the same way. Nothing
 * here re-states who may see what.
 */

export type Tone = "neutral" | "success" | "warning" | "danger"

export interface RowView {
  title: string
  subtitle?: string
  meta?: string
  badge?: string
  tone?: Tone
}

/**
 * Something a row can be made to do.
 *
 * `run` calls a database function, never a table write, because that is where
 * the rules live: apply_leave checks the balance, decide_leave_request checks
 * that the caller is allowed to decide. Offering an action here is a guess that
 * it will be permitted — the database is what actually decides, and a refusal
 * comes back as an error the list surfaces. Nothing is re-checked in the app,
 * so there is no second copy of the rules to drift out of step.
 */
export interface RowAction {
  label: string
  destructive?: boolean
  /**
   * Ask for a line of text first, and pass it to `run`.
   *
   * A written reason is not something an Alert can collect — Alert.prompt is
   * iOS only, and on Android it silently does nothing, which would have meant
   * rejections going out with no note on exactly the platform this app ships
   * on. The list screen renders a small sheet instead.
   */
  prompt?: { title: string; placeholder: string; minLength: number }
  run: (row: Record<string, any>, note?: string) => Promise<unknown>
}

export interface SectionDef {
  /** Shown on the module grid: an Ionicons name and the colour it is tinted. */
  icon: string
  tint: string
  /** How the tile moves when tapped — matched to what the icon depicts. */
  motion: MotionName
  key: string
  title: string
  /** Shown under the title while the list is empty, to say what belongs here. */
  empty: string
  /**
   * Where the rows come from: a view to select from, or a function to call.
   *
   * Most sections are a list of records and a table is the honest description.
   * A report is not — it is an aggregate the database computes and re-checks
   * permission for, and there is no table that holds it. Rather than fake one,
   * a section may name an `rpc` instead, and the loader calls it.
   */
  table: string
  query: SelectOptions
  /** Call this function instead of selecting from `table`. */
  rpc?: string
  /** Roles this section is offered to. Omitted means everyone; the database
   *  decides regardless, this only avoids showing a tile that will refuse. */
  roles?: string[]
  row: (r: Record<string, any>) => RowView
  /** Offered on tap. Omitted where a row is a record rather than a decision. */
  rowActions?: (r: Record<string, any>) => RowAction[]
  /**
   * A section-level action, shown as a button in the header.
   *
   * `roles` gates the button alone, not the section: everyone has letters, but
   * only HR issues them, so Letters is offered to all and its Generate button
   * to three roles. Section-level `roles` cannot express that, and gating the
   * whole section on HR would hide from employees the letters that are theirs.
   * As everywhere else here, this only avoids offering something that would be
   * refused — generate_letter checks the caller itself.
   */
  screenAction?: { label: string; kind: "apply-leave" | "generate-letter"; roles?: string[] }
  /**
   * Tapping a row opens a document rather than an action sheet.
   *
   * A letter is the one thing in this app that is read rather than scanned, so
   * its row leads somewhere instead of offering a list of verbs.
   */
  opens?: "letter"
  /**
   * Narrow this list to the signed-in employee.
   *
   * For a section whose rows name a person — tasks, payslips, the directory —
   * the list is a view of the company and the name is what makes each row make
   * sense. Attendance is the opposite: its rows are titled by date and carry no
   * name at all, because it was written to be *your* attendance. It was not
   * being filtered, so anyone who can read the whole company's — HR, a founder
   * — opened "Attendance" and got 120 rows of everybody's punches, formatted
   * exactly like their own history and with no name to tell them apart.
   *
   * Row level security is not the thing to lean on here. It hid the problem for
   * employees, which is what let it sit unnoticed: the list looked right for
   * everyone who could only see themselves.
   */
  scopeToMe?: boolean
}

/** The order a task moves through, so "next" is a single obvious step. */
const TASK_FLOW: Record<string, string> = {
  todo: "in_progress",
  to_do: "in_progress",
  assigned: "in_progress",
  in_progress: "review",
  review: "completed",
}

/**
 * Status to colour, across every enum these lists can show — taken from the
 * database's own enums rather than from the values that happened to appear in
 * the seed data, so a status nobody has produced yet still gets its colour.
 *
 * `assigned` is a genuine collision: an assigned task is simply not started,
 * while an assigned asset is out with someone and accounted for. Neutral reads
 * correctly for both, which is why it is not given a happier colour.
 *
 * Anything unmapped falls back to neutral, so an enum gaining a value shows a
 * plain badge rather than crashing or, worse, borrowing a misleading colour.
 */
const statusTone: Record<string, Tone> = {
  // leaves, tasks
  approved: "success",
  completed: "success",
  pending: "warning",
  in_progress: "warning",
  review: "warning",
  assigned: "neutral",
  todo: "neutral",
  to_do: "neutral",
  rejected: "danger",
  cancelled: "danger",
  // attendance
  present: "success",
  half_day: "warning",
  on_leave: "neutral",
  absent: "danger",
  // projects
  active: "success",
  planning: "neutral",
  on_hold: "warning",
  // assets
  available: "success",
  maintenance: "warning",
  retired: "neutral",
}

/** "2026-09-05" -> "5 Sep". Dates in a list are for orientation, not filing. */
/**
 * A punch's coordinates, short enough to sit on a row.
 *
 * Four decimal places is roughly eleven metres, which is as fine as a phone
 * fix is worth reading; printing the six the column stores would imply a
 * precision the reading does not have.
 *
 * The accuracy radius is shown alongside rather than hidden, because a pair of
 * coordinates on their own invites "they were not at the office" from a
 * reading that was never good enough to say so.
 */
export function placeLabel(lat: unknown, lon: unknown, accuracy: unknown): string {
  const n = (v: unknown) => (v == null ? null : Number(v))
  const la = n(lat)
  const lo = n(lon)
  if (la === null || lo === null || Number.isNaN(la) || Number.isNaN(lo)) return ""
  const radius = n(accuracy)
  const within = radius === null || Number.isNaN(radius) ? "" : ` ±${Math.round(radius)}m`
  return `${la.toFixed(4)}, ${lo.toFixed(4)}${within}`
}

function shortDate(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** A timestamp as a clock time, or a dash where there is no time yet. */
function clockTime(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Numeric strings from Postgres, grouped the way Indian currency is read. */
function rupees(value: string | number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

export const SECTIONS: SectionDef[] = [
  {
    key: "people",
    motion: "bob",
    icon: "people-outline",
    tint: "#6366f1",
    title: "People",
    empty: "No colleagues listed yet.",
    table: "employee_directory",
    query: {
      columns: "id, full_name, email, designation_title, department_name",
      order: [{ column: "full_name", ascending: true }],
      limit: 200,
    },
    row: (r) => ({
      title: r.full_name,
      subtitle: r.email,
      meta: r.department_name ?? "",
      badge: r.designation_title ?? undefined,
    }),
  },
  {
    key: "tasks",
    motion: "tick",
    icon: "checkmark-done-outline",
    tint: "#0ea5e9",
    title: "Tasks",
    empty: "Nothing assigned.",
    table: "task_directory",
    query: {
      columns: "id, title, project_name, assignee_name, priority, due_date, status, progress",
      order: [{ column: "due_date", ascending: true }],
      limit: 100,
    },
    row: (r) => ({
      title: r.title,
      subtitle: [r.project_name, r.assignee_name].filter(Boolean).join(" · "),
      meta: r.due_date ? `due ${shortDate(r.due_date)}` : "",
      badge: String(r.status).replace("_", " "),
      tone: statusTone[r.status] ?? "neutral",
    }),
    // One step along the flow, not a free choice of status. A task that is
    // already completed has nowhere to go, so it offers nothing.
    rowActions: (r) => {
      const next = TASK_FLOW[r.status]
      if (!next) return []
      return [
        {
          label: `Move to ${next.replace("_", " ")}`,
          run: (row) =>
            updateTask(row.id, {
              status: next,
              // Kept consistent with the status rather than left behind: a task
              // marked done reading 35% complete is a contradiction someone has
              // to go and fix by hand.
              progress: next === "completed" ? 100 : row.progress,
            }),
        },
      ]
    },
  },
  {
    key: "leaves",
    motion: "fly",
    icon: "airplane-outline",
    tint: "#f59e0b",
    title: "Leaves",
    empty: "No leave requests.",
    table: "leave_request_detail",
    query: {
      columns:
        "id, employee_name, leave_type_name, start_date, end_date, days_count, status, decision_note",
      order: [{ column: "start_date", ascending: false }],
      limit: 100,
    },
    row: (r) => ({
      title: r.leave_type_name ?? "Leave",
      // The decision note replaces the dates once there is one: a rejected
      // request's reason is the thing the person opened the list to read, and
      // the dates are already in the row they applied on.
      subtitle: r.decision_note
        ? `${shortDate(r.start_date)}–${shortDate(r.end_date)} · ${r.decision_note}`
        : `${r.employee_name} · ${shortDate(r.start_date)}–${shortDate(r.end_date)}`,
      meta: `${Number(r.days_count)}d`,
      badge: r.status,
      tone: statusTone[r.status] ?? "neutral",
    }),
    screenAction: { label: "Apply", kind: "apply-leave" },
    // Offered on anything still pending. Whether this caller may actually decide
    // is decide_leave_request's business — an employee tapping Approve on their
    // own request gets the database's refusal, which is the correct answer from
    // the correct place.
    rowActions: (r) =>
      r.status !== "pending"
        ? []
        : [
            {
              label: "Approve",
              prompt: { title: "Approve leave", placeholder: "Note (optional)", minLength: 0 },
              run: (row, note) => decideLeave(row.id, true, note),
            },
            {
              label: "Reject",
              destructive: true,
              prompt: {
                title: "Why are you rejecting this?",
                placeholder: "They will read this",
                minLength: 10,
              },
              run: (row, note) => decideLeave(row.id, false, note),
            },
          ],
  },
  {
    key: "payslips",
    motion: "open",
    icon: "wallet-outline",
    tint: "#16a34a",
    title: "Payslips",
    empty: "No payslips yet.",
    table: "payslip_detail",
    query: {
      columns: "id, employee_name, month, year, gross_pay, net_pay",
      order: [{ column: "year", ascending: false }],
      limit: 60,
    },
    row: (r) => ({
      title: `${MONTHS[(Number(r.month) || 1) - 1]} ${r.year}`,
      subtitle: r.employee_name,
      meta: rupees(r.net_pay),
      badge: `gross ${rupees(r.gross_pay)}`,
    }),
  },
  {
    key: "projects",
    motion: "open",
    icon: "folder-open-outline",
    tint: "#8b5cf6",
    title: "Projects",
    empty: "No projects.",
    table: "project_directory",
    query: {
      columns: "id, name, description, priority, status, deadline, progress, member_count",
      order: [{ column: "deadline", ascending: true }],
      limit: 100,
    },
    row: (r) => ({
      title: r.name,
      subtitle: r.description,
      meta: `${r.progress ?? 0}%`,
      badge: `${r.status} · ${r.member_count} member${Number(r.member_count) === 1 ? "" : "s"}`,
      tone: statusTone[r.status] ?? "neutral",
    }),
  },
  {
    key: "attendance",
    scopeToMe: true,
    motion: "sweep",
    icon: "time-outline",
    tint: "#0284c7",
    title: "Attendance",
    empty: "No attendance recorded.",
    table: "attendance_detail",
    query: {
      columns: "id, employee_name, date, check_in, check_out, status, working_hours, is_late, check_in_method, check_in_latitude, check_in_longitude, check_in_accuracy_m",
      order: [{ column: "date", ascending: false }],
      limit: 120,
    },
    row: (r) => ({
      title: shortDate(r.date),
      subtitle: `${clockTime(r.check_in)} – ${clockTime(r.check_out)}${
        r.check_in_method === "biometric" ? " · biometric" : ""
      }${r.check_in_latitude != null ? " · " + placeLabel(r.check_in_latitude, r.check_in_longitude, r.check_in_accuracy_m) : ""}`,
      meta: r.working_hours != null ? `${Number(r.working_hours)}h` : "",
      // "Late" is the more useful of the two on a row that already shows times,
      // so it wins the single badge slot when both apply.
      badge: r.is_late ? "late" : String(r.status).replace("_", " "),
      tone: r.is_late ? "warning" : (statusTone[r.status] ?? "neutral"),
    }),
  },
  {
    key: "reporting",
    motion: "bob",
    icon: "git-network-outline",
    tint: "#6366f1",
    title: "Reporting Hierarchy",
    empty: "No employees to report on.",
    // An aggregate, not a table: report_reporting_manager groups the company by
    // who reports to whom and re-checks for an HR role before it reads a row.
    table: "employees",
    rpc: "report_reporting_manager",
    roles: ["founder", "company_admin", "hr_admin"],
    query: {},
    row: (r) => ({
      title: r.manager_name,
      subtitle:
        (r.reports ?? []).map((x: Record<string, any>) => x.full_name).join(", ") || "no reports",
      meta: `${r.team_size}`,
      // The unassigned group is the finding, not a statistic — it is the row
      // someone opens this report to find, so it is coloured like one.
      badge: r.manager_id === null ? "unassigned" : (r.manager_designation || "manager"),
      tone: r.manager_id === null ? "warning" : "neutral",
    }),
  },
  {
    key: "assets",
    motion: "lid",
    icon: "laptop-outline",
    tint: "#06b6d4",
    title: "Assets",
    empty: "No assets recorded.",
    table: "asset_detail",
    query: {
      columns: "id, name, category, serial_number, status, assigned_to_name, purchase_date",
      order: [{ column: "name", ascending: true }],
      limit: 100,
    },
    row: (r) => ({
      title: r.name,
      subtitle: [r.category, r.serial_number].filter(Boolean).join(" · "),
      meta: r.assigned_to_name ?? "unassigned",
      badge: r.status,
      tone: statusTone[r.status] ?? "neutral",
    }),
  },
  {
    key: "policies",
    motion: "flip",
    icon: "document-text-outline",
    tint: "#64748b",
    title: "Policies",
    empty: "No policies published.",
    table: "policy_detail",
    query: {
      columns: "id, title, content, version, updated_by_name, updated_at",
      order: [{ column: "title", ascending: true }],
      limit: 50,
    },
    row: (r) => ({
      title: r.title,
      subtitle: r.content,
      meta: shortDate(r.updated_at),
      badge: `v${r.version}`,
    }),
  },
  {
    key: "letters",
    motion: "flip",
    icon: "ribbon-outline",
    tint: "#d97706",
    title: "HR Letters",
    empty: "No letters issued yet. Tap Generate above to issue an offer, joining, or other letter.",
    table: "generated_letter_detail",
    query: {
      columns: "id, employee_id, employee_name, letter_type, generated_by_name, generated_at",
      order: [{ column: "generated_at", ascending: false }],
      limit: 100,
    },
    // Not scoped to the signed-in employee, and that is the intended reading
    // rather than the omission the attendance note warns about: for HR this is
    // the issue log — who has been sent what — and the employee name is in the
    // row that makes it legible. Everyone else is narrowed to their own letters
    // by generated_letters_read, which is the same answer the portal's "My
    // Letters" tab gives.
    // The issuer goes in the subtitle rather than the badge: badges are
    // title-cased for statuses, which turns "by Ravi Shanker" into "By Ravi
    // Shanker". Both names stay in the searched text either way.
    row: (r) => ({
      title: LETTER_TITLES[r.letter_type as keyof typeof LETTER_TITLES] ?? String(r.letter_type),
      subtitle: `${r.employee_name} · issued by ${r.generated_by_name}`,
      meta: shortDate(r.generated_at),
    }),
    opens: "letter",
    screenAction: {
      label: "Generate",
      kind: "generate-letter",
      roles: ["founder", "company_admin", "hr_admin"],
    },
  },
  {
    key: "calendar",
    motion: "riffle",
    icon: "calendar-outline",
    tint: "#f43f5e",
    title: "Calendar",
    empty: "Nothing scheduled.",
    table: "company_event_detail",
    query: {
      columns: "id, title, description, event_date, event_type, created_by_name",
      order: [{ column: "event_date", ascending: true }],
      limit: 100,
    },
    row: (r) => ({
      title: r.title,
      subtitle: r.description,
      meta: shortDate(r.event_date),
      badge: r.event_type ?? undefined,
    }),
  },
  {
    key: "announcements",
    motion: "shout",
    icon: "megaphone-outline",
    tint: "#f97316",
    title: "Announcements",
    empty: "Nothing announced.",
    table: "announcement_detail",
    query: {
      columns: "id, title, body, category, pinned, created_by_name, created_at",
      order: [{ column: "created_at", ascending: false }],
      limit: 50,
    },
    row: (r) => ({
      title: r.title,
      subtitle: r.body,
      meta: shortDate(r.created_at),
      badge: r.pinned ? "pinned" : undefined,
      tone: r.pinned ? "warning" : "neutral",
    }),
  },
]

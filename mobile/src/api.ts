import Constants from "expo-constants"
import * as SecureStore from "expo-secure-store"

/**
 * The HRMS API, as the phone sees it.
 *
 * Same server the web app talks to — there is no mobile backend. The one thing
 * that differs is the base URL: a phone cannot reach the laptop's localhost, so
 * `apiUrl` in app.json has to name a host the device can actually resolve, and
 * a wrong value here looks exactly like the server being down.
 */
const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:3001"

const TOKEN_KEY = "hrms.session.token"

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY).catch(() => null)
}

export async function setToken(token: string | null): Promise<void> {
  if (token === null) await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined)
  else await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const token = await getToken()
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Free ngrok puts an interstitial in front of browser-looking requests.
      // fetch from the app is not a browser navigation, but the header costs
      // nothing and removes a confusing "unexpected token <" failure mode.
      "ngrok-skip-browser-warning": "1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  const text = await res.text()
  const body = text ? safeParse(text) : null

  if (!res.ok) {
    if (res.status === 401) await setToken(null)
    throw new ApiError(body?.error ?? res.statusText, res.status)
  }
  return body
}

function safeParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    // An HTML body here means the request reached something other than the API
    // — a tunnel warning page, or the wrong host in app.json.
    return { error: "The server returned an unexpected response. Check apiUrl in app.json." }
  }
}

export interface SessionUser {
  id: number
  email: string
  role: string
  employeeId: number | null
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const body = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  await setToken(body.access_token)
  return body.user
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" }).catch(() => undefined)
  await setToken(null)
}

export async function me(): Promise<SessionUser | null> {
  if (!(await getToken())) return null
  return request("/auth/me").catch(() => null)
}

/**
 * Asks for a password reset link to be emailed.
 *
 * The server answers the same way whether or not the address has an account,
 * and this returns that answer verbatim rather than adding a cheerier one. That
 * is not politeness: an app that said "no such user" would let anyone turn this
 * screen into a check for whether a given person works here, which is the list
 * a phishing campaign starts from. So the screen cannot promise the mail is
 * coming, and does not.
 *
 * No token is sent back — the emailed link is the only copy — so the app's part
 * ends here and the reset itself is finished from the link.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const body = await request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email: email.trim() }),
  })
  return (
    body?.message ?? "If that address has an account, a reset link is on its way."
  )
}

export interface TodayRecord {
  id: number
  date: string
  check_in: string | null
  check_out: string | null
  status: string
}

/** Today's row for the signed-in employee, or null before the first punch. */
/**
 * The signed-in person's own attendance for today.
 *
 * `employeeId` is not optional, and the filter on it is the whole point.
 *
 * This used to select on the date alone and take the first row, which is right
 * only for someone who can see nothing but their own attendance. HR can see the
 * whole company's, so the first row for today was whoever had punched in first
 * — and an HR admin opening the app was shown a colleague's check-in as their
 * own, with the button offering to check *them* out. Row level security was
 * working exactly as intended; the query was asking the wrong question.
 *
 * That is the failure mode of a filter left to RLS: it is invisible for the
 * roles that see least, and wrong for the ones that see most.
 */
export async function today(employeeId: number | null): Promise<TodayRecord | null> {
  // No employee record means no attendance to have. Asking anyway would return
  // the unfiltered first row again, which is the bug this replaced.
  if (employeeId === null) return null

  const iso = new Date().toISOString().slice(0, 10)
  const body = await request("/query", {
    method: "POST",
    body: JSON.stringify({
      table: "attendance_detail",
      action: "select",
      columns: "id, date, check_in, check_out, status",
      filters: [
        { column: "date", op: "eq", value: iso },
        { column: "employee_id", op: "eq", value: employeeId },
      ],
      limit: 1,
    }),
  })
  return body?.data?.[0] ?? null
}

// ------------------------------------------------------------ device auth
export async function registerDevice(publicKey: string, label: string): Promise<void> {
  await request("/device/register", {
    method: "POST",
    body: JSON.stringify({ publicKey, label }),
  })
}

export async function deviceChallenge(): Promise<string> {
  const body = await request("/device/challenge", { method: "POST" })
  return body.challenge as string
}

export async function devicePunch(
  direction: "in" | "out",
  signature: string,
  photo: string | null
): Promise<{ id: number; photoStored: boolean }> {
  return request(`/device/punch/${direction}`, {
    method: "POST",
    body: JSON.stringify({ signature, photo }),
  })
}

// ---------------------------------------------------------------- reading
/**
 * A read against one of the API's curated collections.
 *
 * Deliberately thin: the same /query endpoint the web app uses, with the same
 * shape, so a screen here and a screen there fetch the same rows through the
 * same row level security. There is no mobile-specific API and no second copy
 * of the access rules to keep in step.
 */
export interface SelectOptions {
  columns?: string
  filters?: { column: string; op: string; value: unknown }[]
  order?: { column: string; ascending: boolean }[]
  limit?: number
}

export async function select<T>(table: string, opts: SelectOptions = {}): Promise<T[]> {
  const body = await request("/query", {
    method: "POST",
    body: JSON.stringify({
      table,
      action: "select",
      columns: opts.columns ?? "*",
      filters: opts.filters,
      order: opts.order,
      limit: opts.limit,
    }),
  })
  return (body?.data ?? []) as T[]
}

// ---------------------------------------------------------------- actions
/**
 * A database function call — how the HRMS performs almost every write.
 *
 * Deliberately the same route the web app uses. These functions carry the
 * business rules (a leave request checks the balance, a decision checks that
 * the caller may decide) and run inside the same row level security, so the
 * phone gets those rules for free rather than restating them here — badly, and
 * in a second place that would drift.
 */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return request(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) })
}

export interface LeaveType {
  id: number
  name: string
}

export async function leaveTypes(): Promise<LeaveType[]> {
  return select<LeaveType>("leave_types", {
    columns: "id, name",
    order: [{ column: "name", ascending: true }],
  })
}

/** Books leave. The function checks the balance and the dates, not this code. */
export async function applyLeave(
  leaveTypeId: number,
  startDate: string,
  endDate: string,
  reason: string
): Promise<number> {
  return rpc<number>("apply_leave", {
    p_leave_type_id: leaveTypeId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_reason: reason || null,
  })
}

/** Approve or reject someone's request. Refused by the database unless allowed. */
/**
 * Decide a leave request, saying why.
 *
 * The note reaches the employee on their own request, so a refusal explains
 * itself instead of leaving them to come and ask. Required on a rejection by
 * the same rule the web portal applies — the database accepts a bare decision,
 * and it is the two front ends that agree not to make one.
 */
export async function decideLeave(id: number, approve: boolean, note?: string): Promise<number> {
  return rpc<number>("decide_leave_request", {
    p_id: id,
    p_approve: approve,
    p_note: note?.trim() || null,
  })
}

/** Moves a task along. The patch is a jsonb of the columns to change. */
export async function updateTask(id: number, patch: Record<string, unknown>): Promise<number> {
  return rpc<number>("update_task", { p_id: id, p_patch: patch })
}

// ------------------------------------------------------- internal messages
export interface MessageThread {
  user_id: number
  name: string
  last_body: string
  last_at: string
  unread: number
}

export interface Message {
  id: number
  sender_id: number
  sender_name: string
  recipient_id: number
  recipient_name: string
  body: string
  read_at: string | null
  created_at: string
}

export interface Contact {
  user_id: number
  name: string
  role: string
  designation: string
  department: string
}

/** The inbox: one row per person, most recently active first. */
export async function messageThreads(): Promise<MessageThread[]> {
  return rpc<MessageThread[]>("message_threads")
}

/** Everyone else in the company — who a new conversation can be started with. */
export async function messageContacts(): Promise<Contact[]> {
  return rpc<Contact[]>("message_contacts")
}

/**
 * One conversation, oldest first.
 *
 * The `or` picks which conversation; it cannot widen what is visible. Row level
 * security already limits every row to messages this person sent or received,
 * so asking for someone else's thread returns nothing rather than their
 * messages — the filter chooses, it does not authorise.
 */
export async function messagesWith(userId: number): Promise<Message[]> {
  const body = await request("/query", {
    method: "POST",
    body: JSON.stringify({
      table: "message_detail",
      action: "select",
      columns: "id, sender_id, sender_name, recipient_id, recipient_name, body, read_at, created_at",
      or: `sender_id.eq.${userId},recipient_id.eq.${userId}`,
      order: [{ column: "created_at", ascending: true }],
    }),
  })
  return (body?.data ?? []) as Message[]
}

/**
 * Sends a message.
 *
 * Neither the sender nor the company is sent: the column defaults to the
 * session's own user and the API stamps the company, so there is no field here
 * a caller could put someone else's name in.
 */
export async function sendMessage(recipientId: number, body: string): Promise<void> {
  await request("/query", {
    method: "POST",
    body: JSON.stringify({
      table: "messages",
      action: "insert",
      payload: { recipient_id: recipientId, body: body.trim() },
    }),
  })
}

/** Marks everything received from this person as read — the only update either side may make. */
export async function markThreadRead(userId: number): Promise<void> {
  await request("/query", {
    method: "POST",
    body: JSON.stringify({
      table: "messages",
      action: "update",
      payload: { read_at: new Date().toISOString() },
      filters: [
        { column: "sender_id", op: "eq", value: userId },
        { column: "read_at", op: "is", value: null },
      ],
    }),
  })
}

export type LetterType =
  | "offer"
  | "appointment"
  | "joining"
  | "experience"
  | "relieving"
  | "certificate"
  | "internship"
  | "promotion"
  | "appraisal"
  | "confirmation"
  | "warning"
  | "termination"

/**
 * A letter with every field the document needs already resolved.
 *
 * snake_case, unlike the web app's equivalent type. The wire format is the
 * database's own column names; the portal camelCases on the way in and this app
 * does not, and inventing a camelCase type here would mean a conversion layer
 * that exists for one screen. Every other row the phone reads is snake_case
 * too, so this is the consistent choice rather than the lazy one.
 *
 * `annual_ctc` arrives as a numeric, which node-postgres hands back as a string
 * to avoid losing precision — hence the union. Nothing here does arithmetic on
 * it; it is formatted for display and that is all.
 */
export interface LetterPayload {
  id: number
  letter_type: LetterType
  employee_name: string
  employee_code: string
  employee_address: string | null
  designation_title: string | null
  department_name: string | null
  joining_date: string | null
  reporting_manager_name: string | null
  annual_ctc: number | string | null
  probation_text: string | null
  notice_period_text: string | null
  custom_message: string | null
  company_name: string
  company_address: string | null
  /** The tenant's short code — WPL, PRZ — used in the letter reference line. */
  company_code: string | null
  today: string
  generated_at: string
}

export interface LetterRequest {
  employeeId: number
  letterType: LetterType
  customMessage?: string
  annualCtc?: number
  probationText?: string
  noticePeriodText?: string
}

/**
 * Issues a letter and returns it, ready to render.
 *
 * generate_letter records the letter and resolves the payload in one call, so
 * there is no window in which a letter exists but cannot be shown. It also
 * checks the caller is HR and that the employee belongs to their company — the
 * Generate button is hidden for everyone else, but that is a courtesy, not the
 * control. An unset CTC is sent as null rather than omitted, which is what
 * makes the function fall back to the employee's salary structure.
 */
export async function generateLetter(req: LetterRequest): Promise<LetterPayload> {
  return rpc<LetterPayload>("generate_letter", {
    p_employee_id: req.employeeId,
    p_letter_type: req.letterType,
    p_custom_message: req.customMessage?.trim() || null,
    p_annual_ctc: req.annualCtc ?? null,
    p_probation_text: req.probationText?.trim() || null,
    p_notice_period_text: req.noticePeriodText?.trim() || null,
  })
}

/** Re-opens a letter from the history. Refused unless it is yours or you are HR. */
export async function viewLetter(id: number): Promise<LetterPayload> {
  return rpc<LetterPayload>("get_letter_view", { p_id: id })
}

export interface EmployeeOption {
  id: number
  full_name: string
  designation_title: string | null
}

/** Who a letter can be issued to — the same directory the People list reads. */
export async function employeeOptions(): Promise<EmployeeOption[]> {
  return select<EmployeeOption>("employee_directory", {
    columns: "id, full_name, designation_title",
    order: [{ column: "full_name", ascending: true }],
    limit: 500,
  })
}

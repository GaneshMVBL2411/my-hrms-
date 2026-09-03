import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import type {
  LeaveBalance,
  LeaveRequest,
  LeaveRequestCreate,
  LeaveStatus,
  LeaveType,
} from "@/features/leaves/types"

const REQUEST_COLUMNS =
  "id, employee_id, employee_name, leave_type_id, leave_type_name, start_date, end_date, " +
  "days_count, reason, status, decided_by_name, decided_at, created_at, decision_note"

async function getRequest(id: number): Promise<LeaveRequest> {
  return unwrap<LeaveRequest>(
    await supabase.from("leave_request_detail").select(REQUEST_COLUMNS).eq("id", id).single()
  )
}

export async function listTypes(): Promise<LeaveType[]> {
  return unwrap<LeaveType[]>(
    await supabase.from("leave_types").select("id, name, default_days_per_year").order("name")
  )
}

export async function getBalance(): Promise<LeaveBalance[]> {
  const { data: employeeId, error } = await supabase.rpc("app_employee_id")
  if (error) throw new ApiError(error.message, error.code)
  if (!employeeId) return []

  return unwrap<LeaveBalance[]>(
    await supabase
      .from("leave_balance_detail")
      .select("id, leave_type_id, leave_type_name, year, allocated_days, used_days, remaining_days")
      .eq("employee_id", employeeId)
      .eq("year", new Date().getFullYear())
      .order("leave_type_id")
  )
}

/**
 * "all" is honoured by row level security rather than by a flag: HR can read
 * every request, everyone else only ever sees their own rows.
 */
export async function listRequests(params: {
  scope?: "mine" | "all"
  status?: LeaveStatus
  /** Narrows an "all" listing to one person. Ignored for scope "mine". */
  employeeId?: number
  /** Inclusive window, `YYYY-MM-DD`. Together they select a month. */
  from?: string
  to?: string
}): Promise<LeaveRequest[]> {
  let query = supabase.from("leave_request_detail").select(REQUEST_COLUMNS)

  if (params.scope !== "all") {
    const { data: employeeId, error } = await supabase.rpc("app_employee_id")
    if (error) throw new ApiError(error.message, error.code)
    if (!employeeId) return []
    query = query.eq("employee_id", employeeId)
  } else if (params.employeeId) {
    query = query.eq("employee_id", params.employeeId)
  }

  if (params.status) query = query.eq("status", params.status)

  // Overlap, not containment: leave running 28 Aug -> 3 Sep is time off in both
  // months, and an August report that omitted it would understate the month.
  if (params.from) query = query.gte("end_date", params.from)
  if (params.to) query = query.lte("start_date", params.to)

  const column = params.from || params.to ? "start_date" : "created_at"
  return unwrap<LeaveRequest[]>(await query.order(column, { ascending: false }))
}

export async function applyLeave(payload: LeaveRequestCreate): Promise<LeaveRequest> {
  const id = unwrap<number>(
    await supabase.rpc("apply_leave", {
      p_leave_type_id: payload.leaveTypeId,
      p_start_date: payload.startDate,
      p_end_date: payload.endDate,
      p_reason: payload.reason ?? null,
    })
  )
  return getRequest(id)
}

/**
 * The note is optional on approval and required on a refusal — a decision that
 * costs someone their plans should come with a reason they can read, rather
 * than a status change they have to come and ask about.
 */
export async function approveLeave(id: number, note?: string): Promise<LeaveRequest> {
  unwrapVoid(
    await supabase.rpc("decide_leave_request", { p_id: id, p_approve: true, p_note: note?.trim() || null })
  )
  return getRequest(id)
}

export async function rejectLeave(id: number, note: string): Promise<LeaveRequest> {
  unwrapVoid(
    await supabase.rpc("decide_leave_request", { p_id: id, p_approve: false, p_note: note.trim() })
  )
  return getRequest(id)
}

export async function cancelLeave(id: number): Promise<void> {
  unwrapVoid(await supabase.from("leave_requests").delete().eq("id", id))
}

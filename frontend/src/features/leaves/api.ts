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
  "days_count, reason, status, decided_by_name, decided_at, created_at"

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
}): Promise<LeaveRequest[]> {
  let query = supabase.from("leave_request_detail").select(REQUEST_COLUMNS)

  if (params.scope !== "all") {
    const { data: employeeId, error } = await supabase.rpc("app_employee_id")
    if (error) throw new ApiError(error.message, error.code)
    if (!employeeId) return []
    query = query.eq("employee_id", employeeId)
  }
  if (params.status) query = query.eq("status", params.status)

  return unwrap<LeaveRequest[]>(await query.order("created_at", { ascending: false }))
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

export async function approveLeave(id: number): Promise<LeaveRequest> {
  unwrapVoid(await supabase.rpc("decide_leave_request", { p_id: id, p_approve: true }))
  return getRequest(id)
}

export async function rejectLeave(id: number): Promise<LeaveRequest> {
  unwrapVoid(await supabase.rpc("decide_leave_request", { p_id: id, p_approve: false }))
  return getRequest(id)
}

export async function cancelLeave(id: number): Promise<void> {
  unwrapVoid(await supabase.from("leave_requests").delete().eq("id", id))
}

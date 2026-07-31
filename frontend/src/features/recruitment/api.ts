import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { toCamel, definedOnly } from "@/lib/case"
import { likePattern, pageRange } from "@/lib/query"
import type {
  Candidate,
  CandidateCreate,
  CandidateSummary,
  CandidateUpdate,
  Interview,
  InterviewCreate,
  InterviewUpdate,
  PaginatedCandidates,
} from "@/features/recruitment/types"

const SUMMARY_COLUMNS =
  "id, full_name, email, phone, applied_designation_id, applied_designation_title, status, created_at"
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, source, notes`

export async function listCandidates(params: {
  page: number
  pageSize: number
  status?: string
  search?: string
}): Promise<PaginatedCandidates> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase.from("candidate_directory").select(SUMMARY_COLUMNS, { count: "exact" })
  if (params.status) query = query.eq("status", params.status)
  if (params.search) {
    const pattern = likePattern(params.search)
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
  }

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to)
  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<CandidateSummary[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}

export async function getCandidate(id: number): Promise<Candidate> {
  const [candidate, interviews] = await Promise.all([
    unwrap<Omit<Candidate, "interviews">>(
      await supabase.from("candidate_directory").select(DETAIL_COLUMNS).eq("id", id).single()
    ),
    unwrap<Interview[]>(
      await supabase
        .from("interview_detail")
        .select("id, scheduled_at, interviewer_id, interviewer_name, notes, outcome")
        .eq("candidate_id", id)
        .order("scheduled_at")
    ),
  ])

  return { ...candidate, interviews }
}

export async function createCandidate(payload: CandidateCreate): Promise<Candidate> {
  const candidate = unwrap<{ id: number }>(
    await supabase
      .from("candidates")
      .insert(
        definedOnly({
          full_name: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          applied_designation_id: payload.appliedDesignationId,
          source: payload.source,
          notes: payload.notes,
        })
      )
      .select("id")
      .single()
  )
  return getCandidate(candidate.id)
}

export async function updateCandidate(id: number, payload: CandidateUpdate): Promise<Candidate> {
  unwrapVoid(
    await supabase
      .from("candidates")
      .update(
        definedOnly({
          full_name: payload.fullName,
          phone: payload.phone,
          applied_designation_id: payload.appliedDesignationId,
          status: payload.status,
          source: payload.source,
          notes: payload.notes,
        })
      )
      .eq("id", id)
  )
  return getCandidate(id)
}

export async function deleteCandidate(id: number): Promise<void> {
  unwrapVoid(await supabase.from("candidates").delete().eq("id", id))
}

/** Scheduling the first interview advances the candidate's stage — handled by a DB trigger. */
export async function addInterview(candidateId: number, payload: InterviewCreate): Promise<Candidate> {
  unwrapVoid(
    await supabase.from("interviews").insert(
      definedOnly({
        candidate_id: candidateId,
        scheduled_at: payload.scheduledAt,
        interviewer_id: payload.interviewerId,
        notes: payload.notes,
      })
    )
  )
  return getCandidate(candidateId)
}

export async function updateInterview(interviewId: number, payload: InterviewUpdate): Promise<Candidate> {
  const updated = unwrap<{ candidateId: number }>(
    await supabase
      .from("interviews")
      .update(
        definedOnly({
          scheduled_at: payload.scheduledAt,
          interviewer_id: payload.interviewerId,
          notes: payload.notes,
          outcome: payload.outcome,
        })
      )
      .eq("id", interviewId)
      .select("candidate_id")
      .single()
  )

  return getCandidate(updated.candidateId)
}

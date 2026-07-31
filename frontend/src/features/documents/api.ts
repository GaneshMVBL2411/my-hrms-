import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid } from "@/lib/errors"
import { definedOnly } from "@/lib/case"
import type {
  GeneratedLetter,
  LetterGenerateRequest,
  LetterPayload,
  Policy,
  PolicyCreate,
  PolicyUpdate,
} from "@/features/documents/types"

const POLICY_COLUMNS = "id, title, content, version, updated_by_name, updated_at"

export async function listPolicies(): Promise<Policy[]> {
  return unwrap<Policy[]>(await supabase.from("policy_detail").select(POLICY_COLUMNS).order("title"))
}

export async function createPolicy(payload: PolicyCreate): Promise<Policy> {
  const created = unwrap<{ id: number }>(
    await supabase.from("policies").insert({ title: payload.title, content: payload.content }).select("id").single()
  )
  return unwrap<Policy>(
    await supabase.from("policy_detail").select(POLICY_COLUMNS).eq("id", created.id).single()
  )
}

/** The version bump and the `updated_by` stamp are applied by a trigger. */
export async function updatePolicy(id: number, payload: PolicyUpdate): Promise<Policy> {
  unwrapVoid(await supabase.from("policies").update(definedOnly(payload)).eq("id", id))
  return unwrap<Policy>(await supabase.from("policy_detail").select(POLICY_COLUMNS).eq("id", id).single())
}

export async function deletePolicy(id: number): Promise<void> {
  unwrapVoid(await supabase.from("policies").delete().eq("id", id))
}

/**
 * Records the letter and returns the fully-resolved payload the print view needs
 * — CTC is derived from the salary structure when no override was given.
 */
export async function generateLetter(payload: LetterGenerateRequest): Promise<LetterPayload> {
  return unwrap<LetterPayload>(
    await supabase.rpc("generate_letter", {
      p_employee_id: payload.employeeId,
      p_letter_type: payload.letterType,
      p_custom_message: payload.customMessage ?? null,
      p_annual_ctc: payload.annualCtc ?? null,
      p_probation_text: payload.probationText ?? null,
      p_notice_period_text: payload.noticePeriodText ?? null,
    })
  )
}

export async function listLetters(): Promise<GeneratedLetter[]> {
  return unwrap<GeneratedLetter[]>(
    await supabase
      .from("generated_letter_detail")
      .select("id, employee_id, employee_name, letter_type, generated_by_name, generated_at")
      .order("generated_at", { ascending: false })
  )
}

export async function viewLetter(id: number): Promise<LetterPayload> {
  return unwrap<LetterPayload>(await supabase.rpc("get_letter_view", { p_id: id }))
}

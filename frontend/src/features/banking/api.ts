import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { logAudit } from "@/lib/query"
import type { CompanyBankDetails, CompanyBankUpsert } from "@/features/banking/types"

/**
 * `company_bank_details` has no client grant at all and a deny-everything policy
 * on top (migration 0008) — an account number is a credential, not a column. All
 * four operations therefore go through SECURITY DEFINER functions, each of which
 * re-checks the caller's role in the database rather than trusting this file.
 */

export async function listCompanyBankDetails(): Promise<CompanyBankDetails[]> {
  return unwrap<CompanyBankDetails[]>(await supabase.rpc("get_company_bank_details"))
}

export async function upsertCompanyBankDetails(
  id: number | null,
  payload: CompanyBankUpsert
): Promise<number> {
  // Sent snake_case because the function reads the JSON by key; toSnake() would
  // also turn `upiId` into `upi_id`, but spelling it out keeps the contract with
  // upsert_company_bank_details() visible at the call site.
  const newId = unwrap<number>(
    await supabase.rpc("upsert_company_bank_details", {
      p_id: id,
      p_payload: {
        company_name: payload.companyName,
        legal_name: payload.legalName || null,
        bank_name: payload.bankName,
        account_holder_name: payload.accountHolderName,
        account_number: payload.accountNumber,
        ifsc_code: payload.ifscCode,
        branch_name: payload.branchName || null,
        swift_code: payload.swiftCode || null,
        upi_id: payload.upiId || null,
        gst_number: payload.gstNumber || null,
        pan_number: payload.panNumber || null,
        tan_number: payload.tanNumber || null,
        pf_registration_number: payload.pfRegistrationNumber || null,
        esi_registration_number: payload.esiRegistrationNumber || null,
        authorized_signatory: payload.authorizedSignatory || null,
        logo_url: payload.logoUrl || null,
        signature_url: payload.signatureUrl || null,
        is_primary: payload.isPrimary,
        status: payload.status,
      },
    })
  )

  logAudit(id ? "update" : "create", "company_bank_details", newId)
  return newId
}

export async function verifyCompanyBankDetails(id: number): Promise<void> {
  unwrapVoid(await supabase.rpc("verify_company_bank_details", { p_id: id }))
}

/**
 * Logo and signature share the employee-photo bucket. The path is keyed by
 * record and kind, so re-uploading replaces rather than accumulating — and the
 * cache buster is why the new image actually appears.
 */
export async function uploadCompanyAsset(
  id: number,
  kind: "logo" | "signature",
  file: File
): Promise<string> {
  const extension = file.name.split(".").pop() ?? "png"
  const path = `company/${id}/${kind}.${extension}`

  const { error } = await supabase.storage
    .from("hrms-files")
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (error) throw new ApiError(error.message)

  const {
    data: { publicUrl },
  } = supabase.storage.from("hrms-files").getPublicUrl(path)

  return `${publicUrl}?v=${Date.now()}`
}

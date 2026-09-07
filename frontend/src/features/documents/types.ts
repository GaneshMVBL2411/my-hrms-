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

export interface Policy {
  id: number
  title: string
  content: string
  version: number
  updatedByName: string
  updatedAt: string
}

export interface PolicyCreate {
  title: string
  content: string
}

export interface PolicyUpdate {
  title?: string
  content?: string
}

export interface LetterGenerateRequest {
  employeeId: number
  letterType: LetterType
  customMessage?: string
  annualCtc?: number
  probationText?: string
  noticePeriodText?: string
}

export interface LetterPayload {
  id: number
  letterType: LetterType
  employeeName: string
  employeeCode: string
  employeeAddress: string | null
  designationTitle: string | null
  departmentName: string | null
  joiningDate: string | null
  reportingManagerName: string | null
  annualCtc: number | null
  probationText: string | null
  noticePeriodText: string | null
  customMessage: string | null
  companyName: string
  companyAddress: string | null
  /** The tenant's short code — WPL, PRZ — used in the letter reference line. */
  companyCode: string | null
  today: string
  generatedAt: string
}

export interface GeneratedLetter {
  id: number
  employeeId: number
  employeeName: string
  letterType: LetterType
  generatedByName: string
  generatedAt: string
}

export type CandidateStatus = "applied" | "interview_scheduled" | "interviewed" | "offered" | "joined" | "rejected"
export type InterviewOutcome = "pending" | "pass" | "fail"

export interface Interview {
  id: number
  scheduledAt: string
  interviewerId: number | null
  interviewerName: string | null
  notes: string | null
  outcome: InterviewOutcome
}

export interface CandidateSummary {
  id: number
  fullName: string
  email: string
  phone: string | null
  appliedDesignationId: number | null
  appliedDesignationTitle: string | null
  status: CandidateStatus
  createdAt: string
}

export interface Candidate extends CandidateSummary {
  source: string | null
  notes: string | null
  interviews: Interview[]
}

export interface CandidateCreate {
  fullName: string
  email: string
  phone?: string
  appliedDesignationId?: number
  source?: string
  notes?: string
}

export interface CandidateUpdate {
  fullName?: string
  phone?: string
  appliedDesignationId?: number
  status?: CandidateStatus
  source?: string
  notes?: string
}

export interface InterviewCreate {
  scheduledAt: string
  interviewerId?: number
  notes?: string
}

export interface InterviewUpdate {
  scheduledAt?: string
  interviewerId?: number
  notes?: string
  outcome?: InterviewOutcome
}

export interface PaginatedCandidates {
  items: CandidateSummary[]
  total: number
  page: number
  pageSize: number
}

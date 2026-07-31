from datetime import datetime

from pydantic import EmailStr

from app.models.recruitment import CandidateStatus, InterviewOutcome
from app.schemas.base import CamelModel


class InterviewOut(CamelModel):
    id: int
    scheduled_at: datetime
    interviewer_id: int | None
    interviewer_name: str | None
    notes: str | None
    outcome: InterviewOutcome


class CandidateSummaryOut(CamelModel):
    id: int
    full_name: str
    email: EmailStr
    phone: str | None
    applied_designation_id: int | None
    applied_designation_title: str | None
    status: CandidateStatus
    created_at: datetime


class CandidateOut(CandidateSummaryOut):
    source: str | None
    notes: str | None
    interviews: list[InterviewOut]


class CandidateCreate(CamelModel):
    full_name: str
    email: EmailStr
    phone: str | None = None
    applied_designation_id: int | None = None
    source: str | None = None
    notes: str | None = None


class CandidateUpdate(CamelModel):
    full_name: str | None = None
    phone: str | None = None
    applied_designation_id: int | None = None
    status: CandidateStatus | None = None
    source: str | None = None
    notes: str | None = None


class InterviewCreate(CamelModel):
    scheduled_at: datetime
    interviewer_id: int | None = None
    notes: str | None = None


class InterviewUpdate(CamelModel):
    scheduled_at: datetime | None = None
    interviewer_id: int | None = None
    notes: str | None = None
    outcome: InterviewOutcome | None = None


class PaginatedCandidates(CamelModel):
    items: list[CandidateSummaryOut]
    total: int
    page: int
    page_size: int

from datetime import date, datetime

from app.models.document import LetterType
from app.schemas.base import CamelModel


class PolicyOut(CamelModel):
    id: int
    title: str
    content: str
    version: int
    updated_by_name: str
    updated_at: datetime


class PolicyCreate(CamelModel):
    title: str
    content: str


class PolicyUpdate(CamelModel):
    title: str | None = None
    content: str | None = None


class LetterGenerateRequest(CamelModel):
    employee_id: int
    letter_type: LetterType
    custom_message: str | None = None
    annual_ctc: float | None = None
    probation_text: str | None = None
    notice_period_text: str | None = None


class LetterPayload(CamelModel):
    id: int
    letter_type: LetterType
    employee_name: str
    employee_code: str
    employee_address: str | None
    designation_title: str | None
    department_name: str | None
    joining_date: date | None
    reporting_manager_name: str | None
    annual_ctc: float | None
    probation_text: str | None
    notice_period_text: str | None
    custom_message: str | None
    company_name: str
    company_address: str | None
    today: date
    generated_at: datetime


class GeneratedLetterOut(CamelModel):
    id: int
    employee_id: int
    employee_name: str
    letter_type: LetterType
    generated_by_name: str
    generated_at: datetime

from datetime import date, datetime

from app.schemas.base import CamelModel


class SalaryStructureOut(CamelModel):
    id: int
    employee_id: int
    employee_name: str
    basic: float
    hra: float
    special_allowance: float
    pf_percent: float
    esi_percent: float
    effective_from: date


class SalaryStructureUpsert(CamelModel):
    basic: float
    hra: float = 0
    special_allowance: float = 0
    pf_percent: float = 12
    esi_percent: float = 0.75
    effective_from: date


class PayslipOut(CamelModel):
    id: int
    employee_id: int
    employee_name: str
    employee_code: str
    designation_title: str | None
    department_name: str | None
    joining_date: date | None
    month: int
    year: int
    basic: float
    hra: float
    special_allowance: float
    gross_pay: float
    pf_deduction: float
    esi_deduction: float
    professional_tax: float
    net_pay: float
    generated_at: datetime


class PayslipGenerateRequest(CamelModel):
    employee_id: int
    month: int
    year: int


class PayslipGenerateBulkRequest(CamelModel):
    month: int
    year: int


class PayrollSummaryOut(CamelModel):
    month: int
    year: int
    employee_count: int
    total_gross: float
    total_deductions: float
    total_net: float


class PaginatedPayslips(CamelModel):
    items: list[PayslipOut]
    total: int
    page: int
    page_size: int

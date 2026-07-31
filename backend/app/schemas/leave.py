from datetime import date, datetime

from app.models.leave import LeaveStatus
from app.schemas.base import CamelModel


class LeaveTypeOut(CamelModel):
    id: int
    name: str
    default_days_per_year: int


class LeaveBalanceOut(CamelModel):
    id: int
    leave_type_id: int
    leave_type_name: str
    year: int
    allocated_days: float
    used_days: float
    remaining_days: float


class LeaveRequestOut(CamelModel):
    id: int
    employee_id: int
    employee_name: str
    leave_type_id: int
    leave_type_name: str
    start_date: date
    end_date: date
    days_count: float
    reason: str | None
    status: LeaveStatus
    decided_by_name: str | None
    decided_at: datetime | None
    created_at: datetime


class LeaveRequestCreate(CamelModel):
    leave_type_id: int
    start_date: date
    end_date: date
    reason: str | None = None

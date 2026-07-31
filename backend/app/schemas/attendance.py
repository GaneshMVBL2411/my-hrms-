from datetime import date, datetime

from app.models.attendance import AttendanceStatus
from app.schemas.base import CamelModel


class AttendanceRecordOut(CamelModel):
    id: int
    employee_id: int
    employee_name: str
    date: date
    check_in: datetime | None
    check_out: datetime | None
    break_minutes: int
    status: AttendanceStatus
    working_hours: float | None
    is_late: bool


class AttendanceSummaryOut(CamelModel):
    date: date
    present: int
    absent: int
    on_leave: int
    half_day: int
    total_employees: int


class PaginatedAttendance(CamelModel):
    items: list[AttendanceRecordOut]
    total: int
    page: int
    page_size: int

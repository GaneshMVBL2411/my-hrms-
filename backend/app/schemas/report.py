from app.schemas.base import CamelModel


class AttendanceReportRow(CamelModel):
    employee_id: int
    employee_name: str
    present_days: int
    absent_days: int
    half_days: int
    late_count: int


class LeaveReportRow(CamelModel):
    employee_id: int
    employee_name: str
    leave_type_name: str
    allocated_days: float
    used_days: float
    remaining_days: float


class TaskReportRow(CamelModel):
    assignee_id: int | None
    assignee_name: str
    assigned: int
    in_progress: int
    review: int
    completed: int


class ProjectReportRow(CamelModel):
    id: int
    name: str
    status: str
    priority: str
    progress: int
    member_count: int
    deadline: str | None


class EmployeeReportRow(CamelModel):
    department_name: str
    designation_title: str
    active_count: int
    inactive_count: int

import calendar as pycalendar
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.employee import Employee, EmployeeStatus
from app.models.leave import LeaveBalance
from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.schemas.report import (
    AttendanceReportRow,
    EmployeeReportRow,
    LeaveReportRow,
    ProjectReportRow,
    TaskReportRow,
)


def attendance_report(db: Session, year: int, month: int) -> list[AttendanceReportRow]:
    _, last_day = pycalendar.monthrange(year, month)
    month_start = date(year, month, 1)
    month_end = min(date(year, month, last_day), datetime.now(timezone.utc).date())

    employees = db.scalars(select(Employee).where(Employee.status == EmployeeStatus.ACTIVE)).all()
    days_elapsed = (month_end - month_start).days + 1 if month_end >= month_start else 0

    rows = []
    for emp in employees:
        records = db.scalars(
            select(AttendanceRecord).where(
                AttendanceRecord.employee_id == emp.id,
                AttendanceRecord.date >= month_start,
                AttendanceRecord.date <= month_end,
            )
        ).all()
        present = sum(1 for r in records if r.status == AttendanceStatus.PRESENT)
        half_day = sum(1 for r in records if r.status == AttendanceStatus.HALF_DAY)
        on_leave = sum(1 for r in records if r.status == AttendanceStatus.ON_LEAVE)
        late = sum(1 for r in records if r.is_late)
        absent = max(days_elapsed - present - half_day - on_leave, 0)

        rows.append(
            AttendanceReportRow(
                employee_id=emp.id,
                employee_name=emp.full_name,
                present_days=present,
                absent_days=absent,
                half_days=half_day,
                late_count=late,
            )
        )
    return rows


def leave_report(db: Session, year: int) -> list[LeaveReportRow]:
    balances = db.scalars(
        select(LeaveBalance)
        .options(joinedload(LeaveBalance.employee), joinedload(LeaveBalance.leave_type))
        .where(LeaveBalance.year == year)
        .join(Employee)
        .order_by(Employee.first_name)
    ).all()
    return [
        LeaveReportRow(
            employee_id=b.employee_id,
            employee_name=b.employee.full_name,
            leave_type_name=b.leave_type.name,
            allocated_days=float(b.allocated_days),
            used_days=float(b.used_days),
            remaining_days=float(b.allocated_days) - float(b.used_days),
        )
        for b in balances
    ]


def task_report(db: Session) -> list[TaskReportRow]:
    tasks = db.scalars(select(Task).options(joinedload(Task.assignee))).all()
    by_assignee: dict[int | None, TaskReportRow] = {}

    for t in tasks:
        key = t.assigned_to
        if key not in by_assignee:
            by_assignee[key] = TaskReportRow(
                assignee_id=key,
                assignee_name=t.assignee.full_name if t.assignee else "Unassigned",
                assigned=0,
                in_progress=0,
                review=0,
                completed=0,
            )
        row = by_assignee[key]
        if t.status == TaskStatus.ASSIGNED:
            row.assigned += 1
        elif t.status == TaskStatus.IN_PROGRESS:
            row.in_progress += 1
        elif t.status == TaskStatus.REVIEW:
            row.review += 1
        elif t.status == TaskStatus.COMPLETED:
            row.completed += 1

    return list(by_assignee.values())


def project_report(db: Session) -> list[ProjectReportRow]:
    projects = db.scalars(select(Project).options(joinedload(Project.members))).unique().all()
    return [
        ProjectReportRow(
            id=p.id,
            name=p.name,
            status=p.status.value,
            priority=p.priority.value,
            progress=p.progress,
            member_count=len(p.members),
            deadline=p.deadline.isoformat() if p.deadline else None,
        )
        for p in projects
    ]


def employee_report(db: Session) -> list[EmployeeReportRow]:
    employees = db.scalars(
        select(Employee).options(joinedload(Employee.department), joinedload(Employee.designation))
    ).all()
    grouped: dict[tuple[str, str], EmployeeReportRow] = {}

    for emp in employees:
        dept = emp.department.name if emp.department else "Unassigned"
        desig = emp.designation.title if emp.designation else "Unassigned"
        key = (dept, desig)
        if key not in grouped:
            grouped[key] = EmployeeReportRow(
                department_name=dept, designation_title=desig, active_count=0, inactive_count=0
            )
        if emp.status == EmployeeStatus.ACTIVE:
            grouped[key].active_count += 1
        else:
            grouped[key].inactive_count += 1

    return list(grouped.values())

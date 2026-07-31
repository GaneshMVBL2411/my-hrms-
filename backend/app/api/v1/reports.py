from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.report import (
    AttendanceReportRow,
    EmployeeReportRow,
    LeaveReportRow,
    ProjectReportRow,
    TaskReportRow,
)
from app.services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("/attendance", response_model=list[AttendanceReportRow])
def attendance_report(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    now = datetime.now(timezone.utc)
    return report_service.attendance_report(db, year or now.year, month or now.month)


@router.get("/leaves", response_model=list[LeaveReportRow])
def leave_report(
    year: int = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    now = datetime.now(timezone.utc)
    return report_service.leave_report(db, year or now.year)


@router.get("/tasks", response_model=list[TaskReportRow])
def task_report(db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))):
    return report_service.task_report(db)


@router.get("/projects", response_model=list[ProjectReportRow])
def project_report(db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))):
    return report_service.project_report(db)


@router.get("/employees", response_model=list[EmployeeReportRow])
def employee_report(db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))):
    return report_service.employee_report(db)

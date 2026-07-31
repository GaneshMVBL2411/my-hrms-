from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.attendance import AttendanceRecordOut, AttendanceSummaryOut, PaginatedAttendance
from app.services import attendance_service

router = APIRouter(prefix="/attendance", tags=["attendance"])

VIEW_ALL_ROLES = ("founder", "hr_admin")


def _require_employee(user: User) -> int:
    if not user.employee:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No employee profile linked to this account")
    return user.employee.id


@router.post("/check-in", response_model=AttendanceRecordOut)
def check_in(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    employee_id = _require_employee(user)
    try:
        return attendance_service.check_in(db, employee_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/check-out", response_model=AttendanceRecordOut)
def check_out(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    employee_id = _require_employee(user)
    try:
        return attendance_service.check_out(db, employee_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/me", response_model=list[AttendanceRecordOut])
def my_attendance(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    employee_id = _require_employee(user)
    now = datetime.now(timezone.utc)
    return attendance_service.get_my_attendance(db, employee_id, year or now.year, month or now.month)


@router.get("/summary", response_model=AttendanceSummaryOut)
def summary(
    target_date: date = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return attendance_service.get_summary(db, target_date or datetime.now(timezone.utc).date())


@router.get("", response_model=PaginatedAttendance)
def list_attendance(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100, alias="pageSize"),
    target_date: date | None = Query(default=None, alias="date"),
    employee_id: int | None = Query(default=None, alias="employeeId"),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*VIEW_ALL_ROLES)),
):
    items, total = attendance_service.list_attendance(
        db, page=page, page_size=page_size, target_date=target_date, employee_id=employee_id
    )
    return PaginatedAttendance(items=items, total=total, page=page, page_size=page_size)

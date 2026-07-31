from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.leave import LeaveStatus
from app.models.user import User
from app.schemas.leave import LeaveBalanceOut, LeaveRequestCreate, LeaveRequestOut, LeaveTypeOut
from app.services import leave_service

router = APIRouter(prefix="/leaves", tags=["leaves"])

APPROVER_ROLES = ("founder", "hr_admin")


def _require_employee(user: User) -> int:
    if not user.employee:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No employee profile linked to this account")
    return user.employee.id


@router.get("/types", response_model=list[LeaveTypeOut])
def list_types(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return leave_service.list_types(db)


@router.get("/balance", response_model=list[LeaveBalanceOut])
def my_balance(
    year: int = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    employee_id = _require_employee(user)
    return leave_service.get_balances(db, employee_id, year or datetime.now(timezone.utc).year)


@router.get("", response_model=list[LeaveRequestOut])
def list_requests(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    status_filter: LeaveStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if scope == "all" and user.role.name in APPROVER_ROLES:
        return leave_service.list_requests(db, employee_id=None, status=status_filter)

    employee_id = _require_employee(user)
    return leave_service.list_requests(db, employee_id=employee_id, status=status_filter)


@router.post("", response_model=LeaveRequestOut, status_code=status.HTTP_201_CREATED)
def apply_leave(
    payload: LeaveRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    employee_id = _require_employee(user)
    try:
        return leave_service.create_request(db, employee_id, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.patch("/{request_id}/approve", response_model=LeaveRequestOut)
def approve_leave(
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*APPROVER_ROLES)),
):
    try:
        return leave_service.decide_request(db, request_id, user.id, approve=True)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.patch("/{request_id}/reject", response_model=LeaveRequestOut)
def reject_leave(
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*APPROVER_ROLES)),
):
    try:
        return leave_service.decide_request(db, request_id, user.id, approve=False)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_leave(
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    employee_id = _require_employee(user)
    try:
        leave_service.cancel_request(db, request_id, employee_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

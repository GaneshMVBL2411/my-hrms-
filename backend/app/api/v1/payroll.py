from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.payroll import (
    PaginatedPayslips,
    PayrollSummaryOut,
    PayslipGenerateBulkRequest,
    PayslipGenerateRequest,
    PayslipOut,
    SalaryStructureOut,
    SalaryStructureUpsert,
)
from app.services import payroll_service

router = APIRouter(prefix="/payroll", tags=["payroll"])

MANAGE_ROLES = ("founder", "hr_admin")


def _require_employee(user: User) -> int:
    if not user.employee:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No employee profile linked to this account")
    return user.employee.id


@router.get("/structure/me", response_model=SalaryStructureOut | None)
def my_structure(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    employee_id = _require_employee(user)
    structure = payroll_service.get_structure(db, employee_id)
    return payroll_service.structure_to_out(structure) if structure else None


@router.get("/structure/{employee_id}", response_model=SalaryStructureOut | None)
def get_structure(
    employee_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    structure = payroll_service.get_structure(db, employee_id)
    return payroll_service.structure_to_out(structure) if structure else None


@router.put("/structure/{employee_id}", response_model=SalaryStructureOut)
def upsert_structure(
    employee_id: int,
    payload: SalaryStructureUpsert,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    structure = payroll_service.upsert_structure(db, employee_id, payload)
    return payroll_service.structure_to_out(structure)


@router.get("/payslips", response_model=PaginatedPayslips)
def list_payslips(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
    employee_id: int | None = Query(default=None, alias="employeeId"),
    month: int | None = Query(default=None),
    year: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    is_manager = user.role.name in MANAGE_ROLES
    scoped_employee_id = employee_id if is_manager else _require_employee(user)

    items, total = payroll_service.list_payslips(
        db, page=page, page_size=page_size, employee_id=scoped_employee_id, month=month, year=year
    )
    return PaginatedPayslips(
        items=[payroll_service.payslip_to_out(p) for p in items], total=total, page=page, page_size=page_size
    )


@router.get("/payslips/{payslip_id}", response_model=PayslipOut)
def get_payslip(payslip_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    payslip = payroll_service.get_payslip(db, payslip_id)
    if not payslip:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payslip not found")

    is_manager = user.role.name in MANAGE_ROLES
    if not is_manager and (not user.employee or payslip.employee_id != user.employee.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to perform this action")

    return payroll_service.payslip_to_out(payslip)


@router.post("/payslips/generate", response_model=PayslipOut, status_code=status.HTTP_201_CREATED)
def generate_payslip(
    payload: PayslipGenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    try:
        payslip = payroll_service.generate_payslip(db, payload.employee_id, payload.month, payload.year, user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return payroll_service.payslip_to_out(payslip)


@router.post("/payslips/generate-bulk", response_model=list[PayslipOut])
def generate_bulk(
    payload: PayslipGenerateBulkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    payslips = payroll_service.generate_bulk(db, payload.month, payload.year, user.id)
    return [payroll_service.payslip_to_out(p) for p in payslips]


@router.get("/reports/summary", response_model=PayrollSummaryOut)
def summary(
    month: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    return payroll_service.get_summary(db, month, year)

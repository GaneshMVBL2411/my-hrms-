from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.employee import Employee, EmployeeStatus
from app.models.payroll import Payslip, SalaryStructure
from app.schemas.payroll import (
    PayrollSummaryOut,
    PayslipOut,
    SalaryStructureOut,
    SalaryStructureUpsert,
)

PROFESSIONAL_TAX_THRESHOLD = 15000
PROFESSIONAL_TAX_AMOUNT = 200


@dataclass
class PayslipBreakdown:
    basic: float
    hra: float
    special_allowance: float
    gross_pay: float
    pf_deduction: float
    esi_deduction: float
    professional_tax: float
    net_pay: float


def compute_payslip(structure: SalaryStructure) -> PayslipBreakdown:
    basic = float(structure.basic)
    hra = float(structure.hra)
    special_allowance = float(structure.special_allowance)
    gross = basic + hra + special_allowance

    pf = basic * float(structure.pf_percent) / 100
    esi = gross * float(structure.esi_percent) / 100
    tax = PROFESSIONAL_TAX_AMOUNT if gross > PROFESSIONAL_TAX_THRESHOLD else 0
    net = gross - pf - esi - tax

    return PayslipBreakdown(
        basic=basic,
        hra=hra,
        special_allowance=special_allowance,
        gross_pay=gross,
        pf_deduction=round(pf, 2),
        esi_deduction=round(esi, 2),
        professional_tax=tax,
        net_pay=round(net, 2),
    )


def get_structure(db: Session, employee_id: int) -> SalaryStructure | None:
    return db.scalar(
        select(SalaryStructure)
        .options(joinedload(SalaryStructure.employee))
        .where(SalaryStructure.employee_id == employee_id)
    )


def structure_to_out(structure: SalaryStructure) -> SalaryStructureOut:
    return SalaryStructureOut(
        id=structure.id,
        employee_id=structure.employee_id,
        employee_name=structure.employee.full_name,
        basic=float(structure.basic),
        hra=float(structure.hra),
        special_allowance=float(structure.special_allowance),
        pf_percent=float(structure.pf_percent),
        esi_percent=float(structure.esi_percent),
        effective_from=structure.effective_from,
    )


def upsert_structure(db: Session, employee_id: int, payload: SalaryStructureUpsert) -> SalaryStructure:
    structure = get_structure(db, employee_id)
    if structure:
        for key, value in payload.model_dump().items():
            setattr(structure, key, value)
    else:
        structure = SalaryStructure(employee_id=employee_id, **payload.model_dump())
        db.add(structure)
    db.commit()
    return get_structure(db, employee_id)  # type: ignore[return-value]


def _payslip_query():
    return select(Payslip).options(
        joinedload(Payslip.employee).joinedload(Employee.department),
        joinedload(Payslip.employee).joinedload(Employee.designation),
    )


def payslip_to_out(payslip: Payslip) -> PayslipOut:
    employee = payslip.employee
    return PayslipOut(
        id=payslip.id,
        employee_id=payslip.employee_id,
        employee_name=employee.full_name,
        employee_code=employee.employee_code,
        designation_title=employee.designation.title if employee.designation else None,
        department_name=employee.department.name if employee.department else None,
        joining_date=employee.joining_date,
        month=payslip.month,
        year=payslip.year,
        basic=float(payslip.basic),
        hra=float(payslip.hra),
        special_allowance=float(payslip.special_allowance),
        gross_pay=float(payslip.gross_pay),
        pf_deduction=float(payslip.pf_deduction),
        esi_deduction=float(payslip.esi_deduction),
        professional_tax=float(payslip.professional_tax),
        net_pay=float(payslip.net_pay),
        generated_at=payslip.generated_at,
    )


def list_payslips(
    db: Session, *, page: int, page_size: int, employee_id: int | None, month: int | None, year: int | None
) -> tuple[list[Payslip], int]:
    query = _payslip_query()
    if employee_id:
        query = query.where(Payslip.employee_id == employee_id)
    if month:
        query = query.where(Payslip.month == month)
    if year:
        query = query.where(Payslip.year == year)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(Payslip.year.desc(), Payslip.month.desc()).offset((page - 1) * page_size).limit(page_size)
    payslips = db.scalars(query).unique().all()
    return list(payslips), total


def get_payslip(db: Session, payslip_id: int) -> Payslip | None:
    return db.scalar(_payslip_query().where(Payslip.id == payslip_id))


def generate_payslip(db: Session, employee_id: int, month: int, year: int, generated_by: int) -> Payslip:
    existing = db.scalar(
        select(Payslip).where(Payslip.employee_id == employee_id, Payslip.month == month, Payslip.year == year)
    )
    if existing:
        raise ValueError("A payslip for this employee and month already exists")

    structure = get_structure(db, employee_id)
    if not structure:
        raise ValueError("This employee has no salary structure configured")

    breakdown = compute_payslip(structure)
    payslip = Payslip(
        employee_id=employee_id,
        month=month,
        year=year,
        basic=breakdown.basic,
        hra=breakdown.hra,
        special_allowance=breakdown.special_allowance,
        gross_pay=breakdown.gross_pay,
        pf_deduction=breakdown.pf_deduction,
        esi_deduction=breakdown.esi_deduction,
        professional_tax=breakdown.professional_tax,
        net_pay=breakdown.net_pay,
        generated_by=generated_by,
    )
    db.add(payslip)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("A payslip for this employee and month already exists") from exc
    return get_payslip(db, payslip.id)  # type: ignore[return-value]


def generate_bulk(db: Session, month: int, year: int, generated_by: int) -> list[Payslip]:
    employees = db.scalars(select(Employee).where(Employee.status == EmployeeStatus.ACTIVE)).all()
    generated = []
    for employee in employees:
        existing = db.scalar(
            select(Payslip).where(Payslip.employee_id == employee.id, Payslip.month == month, Payslip.year == year)
        )
        if existing:
            continue
        structure = get_structure(db, employee.id)
        if not structure:
            continue

        breakdown = compute_payslip(structure)
        payslip = Payslip(
            employee_id=employee.id,
            month=month,
            year=year,
            basic=breakdown.basic,
            hra=breakdown.hra,
            special_allowance=breakdown.special_allowance,
            gross_pay=breakdown.gross_pay,
            pf_deduction=breakdown.pf_deduction,
            esi_deduction=breakdown.esi_deduction,
            professional_tax=breakdown.professional_tax,
            net_pay=breakdown.net_pay,
            generated_by=generated_by,
        )
        db.add(payslip)
        try:
            db.commit()
        except IntegrityError:
            # Concurrent request already generated this employee's payslip for
            # this month (e.g. a double-click) — skip it, not a real failure.
            db.rollback()
            continue
        db.refresh(payslip)
        generated.append(payslip)

    return generated


def get_summary(db: Session, month: int, year: int) -> PayrollSummaryOut:
    payslips = db.scalars(select(Payslip).where(Payslip.month == month, Payslip.year == year)).all()

    total_gross = sum(float(p.gross_pay) for p in payslips)
    total_net = sum(float(p.net_pay) for p in payslips)
    total_deductions = total_gross - total_net

    return PayrollSummaryOut(
        month=month,
        year=year,
        employee_count=len(payslips),
        total_gross=round(total_gross, 2),
        total_deductions=round(total_deductions, 2),
        total_net=round(total_net, 2),
    )

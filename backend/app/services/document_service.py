from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.company_settings import CompanySettings
from app.models.document import GeneratedLetter, Policy
from app.models.employee import Employee
from app.schemas.document import (
    GeneratedLetterOut,
    LetterGenerateRequest,
    LetterPayload,
    PolicyCreate,
    PolicyOut,
    PolicyUpdate,
)
from app.services import notification_service
from app.services.payroll_service import compute_payslip, get_structure

DEFAULT_PROBATION_TEXT = "Six months from the date of joining"
DEFAULT_NOTICE_PERIOD_TEXT = "Thirty days on either side after confirmation"


def _policy_to_out(policy: Policy) -> PolicyOut:
    return PolicyOut(
        id=policy.id,
        title=policy.title,
        content=policy.content,
        version=policy.version,
        updated_by_name=policy.updater.employee.full_name if policy.updater.employee else policy.updater.email,
        updated_at=policy.updated_at,
    )


def list_policies(db: Session) -> list[PolicyOut]:
    policies = db.scalars(
        select(Policy).options(joinedload(Policy.updater)).order_by(Policy.title)
    ).all()
    return [_policy_to_out(p) for p in policies]


def get_policy(db: Session, policy_id: int) -> Policy | None:
    return db.scalar(select(Policy).options(joinedload(Policy.updater)).where(Policy.id == policy_id))


def create_policy(db: Session, payload: PolicyCreate, updated_by: int) -> PolicyOut:
    policy = Policy(title=payload.title, content=payload.content, version=1, updated_by=updated_by)
    db.add(policy)
    db.commit()
    return _policy_to_out(get_policy(db, policy.id))  # type: ignore[arg-type]


def update_policy(db: Session, policy: Policy, payload: PolicyUpdate, updated_by: int) -> PolicyOut:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(policy, key, value)
    policy.version += 1
    policy.updated_by = updated_by
    db.commit()
    return _policy_to_out(get_policy(db, policy.id))  # type: ignore[arg-type]


def delete_policy(db: Session, policy: Policy) -> None:
    db.delete(policy)
    db.commit()


def _build_letter_payload(db: Session, record: GeneratedLetter, employee: Employee) -> LetterPayload:
    company = db.scalar(select(CompanySettings))

    if record.annual_ctc_override is not None:
        annual_ctc = float(record.annual_ctc_override)
    else:
        structure = get_structure(db, employee.id)
        annual_ctc = compute_payslip(structure).gross_pay * 12 if structure else None

    return LetterPayload(
        id=record.id,
        letter_type=record.letter_type,
        employee_name=employee.full_name,
        employee_code=employee.employee_code,
        employee_address=employee.address,
        designation_title=employee.designation.title if employee.designation else None,
        department_name=employee.department.name if employee.department else None,
        joining_date=employee.joining_date,
        reporting_manager_name=employee.reporting_manager.full_name if employee.reporting_manager else None,
        annual_ctc=annual_ctc,
        probation_text=record.probation_text or DEFAULT_PROBATION_TEXT,
        notice_period_text=record.notice_period_text or DEFAULT_NOTICE_PERIOD_TEXT,
        custom_message=record.custom_message,
        company_name=company.company_name if company else "Whhohh Path LLP",
        company_address=company.address if company else None,
        today=datetime.now(timezone.utc).date(),
        generated_at=record.generated_at,
    )


def generate_letter(db: Session, payload: LetterGenerateRequest, generated_by: int) -> LetterPayload:
    employee = db.scalar(
        select(Employee)
        .options(
            joinedload(Employee.designation),
            joinedload(Employee.department),
            joinedload(Employee.reporting_manager),
        )
        .where(Employee.id == payload.employee_id)
    )
    if not employee:
        raise ValueError("Employee not found")

    record = GeneratedLetter(
        employee_id=employee.id,
        letter_type=payload.letter_type,
        custom_message=payload.custom_message,
        annual_ctc_override=payload.annual_ctc,
        probation_text=payload.probation_text,
        notice_period_text=payload.notice_period_text,
        generated_by=generated_by,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    notification_service.notify_letter_generated(db, employee_id=employee.id, letter_type=payload.letter_type.value)

    return _build_letter_payload(db, record, employee)


def get_letter(db: Session, letter_id: int) -> GeneratedLetter | None:
    return db.scalar(
        select(GeneratedLetter)
        .options(
            joinedload(GeneratedLetter.employee).joinedload(Employee.designation),
            joinedload(GeneratedLetter.employee).joinedload(Employee.department),
            joinedload(GeneratedLetter.employee).joinedload(Employee.reporting_manager),
        )
        .where(GeneratedLetter.id == letter_id)
    )


def get_letter_view(db: Session, letter_id: int) -> LetterPayload | None:
    record = get_letter(db, letter_id)
    if not record:
        return None
    return _build_letter_payload(db, record, record.employee)


def list_letters(db: Session, *, employee_id: int | None = None) -> list[GeneratedLetterOut]:
    query = select(GeneratedLetter).options(
        joinedload(GeneratedLetter.employee), joinedload(GeneratedLetter.generator)
    )
    if employee_id is not None:
        query = query.where(GeneratedLetter.employee_id == employee_id)
    letters = db.scalars(query.order_by(GeneratedLetter.generated_at.desc())).all()
    return [
        GeneratedLetterOut(
            id=letter.id,
            employee_id=letter.employee_id,
            employee_name=letter.employee.full_name,
            letter_type=letter.letter_type,
            generated_by_name=letter.generator.employee.full_name if letter.generator.employee else letter.generator.email,
            generated_at=letter.generated_at,
        )
        for letter in letters
    ]

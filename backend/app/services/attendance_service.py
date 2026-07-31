from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.employee import Employee, EmployeeStatus
from app.models.leave import LeaveRequest, LeaveStatus
from app.schemas.attendance import AttendanceRecordOut, AttendanceSummaryOut


def _to_out(record: AttendanceRecord) -> AttendanceRecordOut:
    return AttendanceRecordOut(
        id=record.id,
        employee_id=record.employee_id,
        employee_name=record.employee.full_name,
        date=record.date,
        check_in=record.check_in,
        check_out=record.check_out,
        break_minutes=record.break_minutes,
        status=record.status,
        working_hours=record.working_hours,
        is_late=record.is_late,
    )


def _get_or_create_today(db: Session, employee_id: int, today: date) -> AttendanceRecord:
    record = db.scalar(
        select(AttendanceRecord)
        .options(joinedload(AttendanceRecord.employee))
        .where(AttendanceRecord.employee_id == employee_id, AttendanceRecord.date == today)
    )
    if not record:
        record = AttendanceRecord(employee_id=employee_id, date=today, status=AttendanceStatus.PRESENT)
        db.add(record)
        db.flush()
        db.refresh(record)
    return record


def check_in(db: Session, employee_id: int) -> AttendanceRecordOut:
    today = datetime.now(timezone.utc).date()
    record = _get_or_create_today(db, employee_id, today)
    if record.check_in:
        raise ValueError("Already checked in today")

    record.check_in = datetime.now(timezone.utc)
    record.status = AttendanceStatus.PRESENT
    db.commit()
    db.refresh(record)
    return _to_out(record)


def check_out(db: Session, employee_id: int) -> AttendanceRecordOut:
    today = datetime.now(timezone.utc).date()
    record = db.scalar(
        select(AttendanceRecord)
        .options(joinedload(AttendanceRecord.employee))
        .where(AttendanceRecord.employee_id == employee_id, AttendanceRecord.date == today)
    )
    if not record or not record.check_in:
        raise ValueError("You haven't checked in today")
    if record.check_out:
        raise ValueError("Already checked out today")

    record.check_out = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return _to_out(record)


def get_my_attendance(db: Session, employee_id: int, year: int, month: int) -> list[AttendanceRecordOut]:
    records = db.scalars(
        select(AttendanceRecord)
        .options(joinedload(AttendanceRecord.employee))
        .where(
            AttendanceRecord.employee_id == employee_id,
            func.extract("year", AttendanceRecord.date) == year,
            func.extract("month", AttendanceRecord.date) == month,
        )
        .order_by(AttendanceRecord.date)
    ).all()
    return [_to_out(r) for r in records]


def list_attendance(
    db: Session, *, page: int, page_size: int, target_date: date | None, employee_id: int | None
) -> tuple[list[AttendanceRecordOut], int]:
    query = select(AttendanceRecord).options(joinedload(AttendanceRecord.employee))
    if target_date:
        query = query.where(AttendanceRecord.date == target_date)
    if employee_id:
        query = query.where(AttendanceRecord.employee_id == employee_id)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(AttendanceRecord.date.desc()).offset((page - 1) * page_size).limit(page_size)
    records = db.scalars(query).unique().all()
    return [_to_out(r) for r in records], total


def get_summary(db: Session, target_date: date) -> AttendanceSummaryOut:
    total_employees = db.scalar(
        select(func.count()).select_from(Employee).where(Employee.status == EmployeeStatus.ACTIVE)
    ) or 0

    present = db.scalar(
        select(func.count())
        .select_from(AttendanceRecord)
        .where(AttendanceRecord.date == target_date, AttendanceRecord.status == AttendanceStatus.PRESENT)
    ) or 0

    half_day = db.scalar(
        select(func.count())
        .select_from(AttendanceRecord)
        .where(AttendanceRecord.date == target_date, AttendanceRecord.status == AttendanceStatus.HALF_DAY)
    ) or 0

    on_leave = db.scalar(
        select(func.count())
        .select_from(LeaveRequest)
        .where(
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.start_date <= target_date,
            LeaveRequest.end_date >= target_date,
        )
    ) or 0

    absent = max(total_employees - present - half_day - on_leave, 0)

    return AttendanceSummaryOut(
        date=target_date,
        present=present,
        absent=absent,
        on_leave=on_leave,
        half_day=half_day,
        total_employees=total_employees,
    )

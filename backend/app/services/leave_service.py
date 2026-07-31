from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.leave import LeaveBalance, LeaveRequest, LeaveStatus, LeaveType
from app.models.user import User
from app.schemas.leave import LeaveBalanceOut, LeaveRequestCreate, LeaveRequestOut, LeaveTypeOut
from app.services import notification_service


def list_types(db: Session) -> list[LeaveTypeOut]:
    types = db.scalars(select(LeaveType).order_by(LeaveType.name)).all()
    return [LeaveTypeOut.model_validate(t) for t in types]


def get_balances(db: Session, employee_id: int, year: int) -> list[LeaveBalanceOut]:
    balances = db.scalars(
        select(LeaveBalance)
        .options(joinedload(LeaveBalance.leave_type))
        .where(LeaveBalance.employee_id == employee_id, LeaveBalance.year == year)
        .order_by(LeaveBalance.leave_type_id)
    ).all()
    return [
        LeaveBalanceOut(
            id=b.id,
            leave_type_id=b.leave_type_id,
            leave_type_name=b.leave_type.name,
            year=b.year,
            allocated_days=float(b.allocated_days),
            used_days=float(b.used_days),
            remaining_days=float(b.allocated_days) - float(b.used_days),
        )
        for b in balances
    ]


def _to_request_out(req: LeaveRequest) -> LeaveRequestOut:
    return LeaveRequestOut(
        id=req.id,
        employee_id=req.employee_id,
        employee_name=req.employee.full_name,
        leave_type_id=req.leave_type_id,
        leave_type_name=req.leave_type.name,
        start_date=req.start_date,
        end_date=req.end_date,
        days_count=float(req.days_count),
        reason=req.reason,
        status=req.status,
        decided_by_name=req.decided_by_user.employee.full_name
        if req.decided_by_user and req.decided_by_user.employee
        else None,
        decided_at=req.decided_at,
        created_at=req.created_at,
    )


def _base_query():
    return select(LeaveRequest).options(
        joinedload(LeaveRequest.employee),
        joinedload(LeaveRequest.leave_type),
        joinedload(LeaveRequest.decided_by_user).joinedload(User.employee),
    )


def list_requests(
    db: Session, *, employee_id: int | None, status: LeaveStatus | None
) -> list[LeaveRequestOut]:
    query = _base_query()
    if employee_id:
        query = query.where(LeaveRequest.employee_id == employee_id)
    if status:
        query = query.where(LeaveRequest.status == status)
    query = query.order_by(LeaveRequest.created_at.desc())
    requests = db.scalars(query).unique().all()
    return [_to_request_out(r) for r in requests]


def get_request(db: Session, request_id: int) -> LeaveRequest | None:
    return db.scalar(_base_query().where(LeaveRequest.id == request_id))


def create_request(db: Session, employee_id: int, payload: LeaveRequestCreate) -> LeaveRequestOut:
    if payload.end_date < payload.start_date:
        raise ValueError("End date must be on or after the start date")

    days_count = (payload.end_date - payload.start_date).days + 1

    request = LeaveRequest(
        employee_id=employee_id,
        leave_type_id=payload.leave_type_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        days_count=days_count,
        reason=payload.reason,
        status=LeaveStatus.PENDING,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return _to_request_out(get_request(db, request.id))  # type: ignore[arg-type]


def decide_request(db: Session, request_id: int, decided_by_user_id: int, approve: bool) -> LeaveRequestOut:
    request = get_request(db, request_id)
    if not request:
        raise ValueError("Leave request not found")
    if request.status != LeaveStatus.PENDING:
        raise ValueError("This request has already been decided")

    request.status = LeaveStatus.APPROVED if approve else LeaveStatus.REJECTED
    request.decided_by = decided_by_user_id
    request.decided_at = datetime.now(timezone.utc)

    if approve:
        balance = db.scalar(
            select(LeaveBalance).where(
                LeaveBalance.employee_id == request.employee_id,
                LeaveBalance.leave_type_id == request.leave_type_id,
                LeaveBalance.year == request.start_date.year,
            )
        )
        if balance:
            balance.used_days = float(balance.used_days) + float(request.days_count)

    db.commit()
    db.refresh(request)

    notification_service.notify_leave_decision(
        db,
        employee_id=request.employee_id,
        leave_type_name=request.leave_type.name,
        start_date=request.start_date,
        end_date=request.end_date,
        days_count=float(request.days_count),
        approved=approve,
    )

    return _to_request_out(get_request(db, request.id))  # type: ignore[arg-type]


def cancel_request(db: Session, request_id: int, employee_id: int) -> None:
    request = db.scalar(select(LeaveRequest).where(LeaveRequest.id == request_id))
    if not request or request.employee_id != employee_id:
        raise ValueError("Leave request not found")
    if request.status != LeaveStatus.PENDING:
        raise ValueError("Only pending requests can be cancelled")

    db.delete(request)
    db.commit()

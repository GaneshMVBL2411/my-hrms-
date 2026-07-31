import calendar as pycalendar
from datetime import date

from sqlalchemy import extract, select
from sqlalchemy.orm import Session, joinedload

from app.models.calendar_event import CompanyEvent
from app.models.employee import Employee
from app.models.leave import LeaveRequest, LeaveStatus
from app.models.project import Project
from app.models.task import Task
from app.schemas.calendar_event import (
    CalendarEntryOut,
    CompanyEventCreate,
    CompanyEventOut,
    CompanyEventUpdate,
)


def get_month_entries(db: Session, year: int, month: int) -> list[CalendarEntryOut]:
    _, last_day = pycalendar.monthrange(year, month)
    month_start = date(year, month, 1)
    month_end = date(year, month, last_day)

    entries: list[CalendarEntryOut] = []

    events = db.scalars(
        select(CompanyEvent).where(CompanyEvent.event_date >= month_start, CompanyEvent.event_date <= month_end)
    ).all()
    for e in events:
        entries.append(CalendarEntryOut(date=e.event_date, type=e.event_type.value, title=e.title))

    leaves = db.scalars(
        select(LeaveRequest)
        .options(joinedload(LeaveRequest.employee))
        .where(
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.start_date <= month_end,
            LeaveRequest.end_date >= month_start,
        )
    ).all()
    for leave in leaves:
        start = max(leave.start_date, month_start)
        entries.append(CalendarEntryOut(date=start, type="leave", title=f"{leave.employee.full_name} on leave"))

    tasks = db.scalars(
        select(Task)
        .where(Task.due_date >= month_start, Task.due_date <= month_end)
    ).all()
    for t in tasks:
        entries.append(CalendarEntryOut(date=t.due_date, type="task_due", title=f"Task due: {t.title}"))  # type: ignore[arg-type]

    projects = db.scalars(
        select(Project).where(Project.deadline >= month_start, Project.deadline <= month_end)
    ).all()
    for p in projects:
        entries.append(CalendarEntryOut(date=p.deadline, type="project_deadline", title=f"Project deadline: {p.name}"))  # type: ignore[arg-type]

    birthdays = db.scalars(
        select(Employee).where(Employee.dob.is_not(None), extract("month", Employee.dob) == month)
    ).all()
    for emp in birthdays:
        try:
            birthday_date = date(year, month, emp.dob.day)  # type: ignore[union-attr]
        except ValueError:
            continue  # Feb 29 birthday in a non-leap year
        entries.append(CalendarEntryOut(date=birthday_date, type="birthday", title=f"{emp.full_name}'s birthday"))

    return sorted(entries, key=lambda e: e.date)


def create_event(db: Session, payload: CompanyEventCreate, created_by: int) -> CompanyEventOut:
    event = CompanyEvent(**payload.model_dump(), created_by=created_by)
    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_out(event)


def _to_out(event: CompanyEvent) -> CompanyEventOut:
    return CompanyEventOut(
        id=event.id,
        title=event.title,
        description=event.description,
        event_date=event.event_date,
        event_type=event.event_type,
        created_by_name=event.creator.employee.full_name if event.creator.employee else event.creator.email,
    )


def list_events(db: Session, year: int, month: int) -> list[CompanyEventOut]:
    _, last_day = pycalendar.monthrange(year, month)
    events = db.scalars(
        select(CompanyEvent)
        .options(joinedload(CompanyEvent.creator))
        .where(
            CompanyEvent.event_date >= date(year, month, 1),
            CompanyEvent.event_date <= date(year, month, last_day),
        )
        .order_by(CompanyEvent.event_date)
    ).all()
    return [_to_out(e) for e in events]


def update_event(db: Session, event: CompanyEvent, payload: CompanyEventUpdate) -> CompanyEventOut:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    db.commit()
    return _to_out(event)


def delete_event(db: Session, event: CompanyEvent) -> None:
    db.delete(event)
    db.commit()

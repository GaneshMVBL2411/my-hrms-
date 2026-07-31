from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.employee import Employee, EmployeeStatus
from app.services import email_service

FOOTER = "<p style='color:#6e7679;font-size:12px'>— Whhohh Path LLP HRMS</p>"


def _employee_email(db: Session, employee_id: int) -> str | None:
    employee = db.get(Employee, employee_id)
    if not employee:
        return None
    return employee.user.email


def notify_leave_decision(
    db: Session,
    *,
    employee_id: int,
    leave_type_name: str,
    start_date: date,
    end_date: date,
    days_count: float,
    approved: bool,
) -> None:
    email = _employee_email(db, employee_id)
    if not email:
        return

    verb = "approved" if approved else "rejected"
    email_service.send_email(
        to=email,
        subject=f"Your {leave_type_name} request has been {verb}",
        body_html=(
            f"<p>Your {leave_type_name} request for {start_date} to {end_date} "
            f"({days_count:g} day(s)) has been <strong>{verb}</strong>.</p>"
            f"{FOOTER}"
        ),
    )


def notify_letter_generated(db: Session, *, employee_id: int, letter_type: str) -> None:
    email = _employee_email(db, employee_id)
    if not email:
        return

    label = letter_type.replace("_", " ").title()
    email_service.send_email(
        to=email,
        subject=f"Your {label} is ready",
        body_html=(
            f"<p>A new document — <strong>{label}</strong> — has been issued to you. "
            f"You can view and print it under Documents &rarr; My Letters in the HRMS.</p>"
            f"{FOOTER}"
        ),
    )


def notify_task_assigned(db: Session, *, employee_id: int, task_title: str, due_date: date | None) -> None:
    email = _employee_email(db, employee_id)
    if not email:
        return

    due_text = f" Due date: {due_date}." if due_date else ""
    email_service.send_email(
        to=email,
        subject=f"New task assigned: {task_title}",
        body_html=f"<p>You've been assigned a new task: <strong>{task_title}</strong>.{due_text}</p>{FOOTER}",
    )


def notify_announcement(db: Session, *, title: str, body: str) -> None:
    employees = db.scalars(
        select(Employee).options(joinedload(Employee.user)).where(Employee.status == EmployeeStatus.ACTIVE)
    ).unique().all()

    for employee in employees:
        email_service.send_email(
            to=employee.user.email,
            subject=f"Announcement: {title}",
            body_html=f"<p>{body}</p>{FOOTER}",
        )

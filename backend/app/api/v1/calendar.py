from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.calendar_event import CompanyEvent
from app.models.user import User
from app.schemas.calendar_event import (
    CalendarEntryOut,
    CompanyEventCreate,
    CompanyEventOut,
    CompanyEventUpdate,
)
from app.services import calendar_service

router = APIRouter(prefix="/calendar", tags=["calendar"])

MANAGE_ROLES = ("founder", "hr_admin", "project_manager", "team_lead")


@router.get("", response_model=list[CalendarEntryOut])
def get_calendar(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    return calendar_service.get_month_entries(db, year or now.year, month or now.month)


@router.get("/events", response_model=list[CompanyEventOut])
def list_events(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    return calendar_service.list_events(db, year or now.year, month or now.month)


@router.post("/events", response_model=CompanyEventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: CompanyEventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    return calendar_service.create_event(db, payload, user.id)


@router.patch("/events/{event_id}", response_model=CompanyEventOut)
def update_event(
    event_id: int,
    payload: CompanyEventUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    event = db.get(CompanyEvent, event_id)
    if not event:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    return calendar_service.update_event(db, event, payload)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    event = db.get(CompanyEvent, event_id)
    if not event:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    calendar_service.delete_event(db, event)

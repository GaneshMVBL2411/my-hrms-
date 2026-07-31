from datetime import date

from app.models.calendar_event import EventType
from app.schemas.base import CamelModel


class CalendarEntryOut(CamelModel):
    date: date
    type: str
    title: str


class CompanyEventOut(CamelModel):
    id: int
    title: str
    description: str | None
    event_date: date
    event_type: EventType
    created_by_name: str


class CompanyEventCreate(CamelModel):
    title: str
    description: str | None = None
    event_date: date
    event_type: EventType = EventType.EVENT


class CompanyEventUpdate(CamelModel):
    title: str | None = None
    description: str | None = None
    event_date: date | None = None
    event_type: EventType | None = None

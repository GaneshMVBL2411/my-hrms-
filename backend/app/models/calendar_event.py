import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EventType(str, enum.Enum):
    MEETING = "meeting"
    EVENT = "event"
    HOLIDAY = "holiday"


class CompanyEvent(Base):
    __tablename__ = "company_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000))
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_type: Mapped[EventType] = mapped_column(
        Enum(EventType, name="event_type_enum", values_callable=lambda obj: [e.value for e in obj]),
        default=EventType.EVENT,
        nullable=False,
    )
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    creator: Mapped["User"] = relationship()  # noqa: F821

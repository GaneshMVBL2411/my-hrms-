import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class LetterType(str, enum.Enum):
    OFFER = "offer"
    APPOINTMENT = "appointment"
    EXPERIENCE = "experience"
    RELIEVING = "relieving"
    CERTIFICATE = "certificate"


class Policy(Base):
    __tablename__ = "policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    updater: Mapped["User"] = relationship()  # noqa: F821


class GeneratedLetter(Base):
    __tablename__ = "generated_letters"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    letter_type: Mapped[LetterType] = mapped_column(
        Enum(LetterType, name="letter_type_enum", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    custom_message: Mapped[str | None] = mapped_column(Text)
    annual_ctc_override: Mapped[float | None] = mapped_column(Numeric(12, 2))
    probation_text: Mapped[str | None] = mapped_column(String(200))
    notice_period_text: Mapped[str | None] = mapped_column(String(200))
    generated_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped["Employee"] = relationship()  # noqa: F821
    generator: Mapped["User"] = relationship()  # noqa: F821

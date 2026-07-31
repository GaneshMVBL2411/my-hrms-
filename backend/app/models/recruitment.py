import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class CandidateStatus(str, enum.Enum):
    APPLIED = "applied"
    INTERVIEW_SCHEDULED = "interview_scheduled"
    INTERVIEWED = "interviewed"
    OFFERED = "offered"
    JOINED = "joined"
    REJECTED = "rejected"


class InterviewOutcome(str, enum.Enum):
    PENDING = "pending"
    PASS_ = "pass"
    FAIL = "fail"


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    applied_designation_id: Mapped[int | None] = mapped_column(ForeignKey("designations.id"))
    status: Mapped[CandidateStatus] = mapped_column(
        Enum(CandidateStatus, name="candidate_status_enum", values_callable=lambda obj: [e.value for e in obj]),
        default=CandidateStatus.APPLIED,
        nullable=False,
    )
    source: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    applied_designation: Mapped["Designation | None"] = relationship()  # noqa: F821
    interviews: Mapped[list["Interview"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan", order_by="Interview.scheduled_at"
    )


class Interview(Base):
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    interviewer_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    notes: Mapped[str | None] = mapped_column(String(2000))
    outcome: Mapped[InterviewOutcome] = mapped_column(
        Enum(InterviewOutcome, name="interview_outcome_enum", values_callable=lambda obj: [e.value for e in obj]),
        default=InterviewOutcome.PENDING,
        nullable=False,
    )

    candidate: Mapped["Candidate"] = relationship(back_populates="interviews")
    interviewer: Mapped["Employee | None"] = relationship()  # noqa: F821

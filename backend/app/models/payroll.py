from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SalaryStructure(Base):
    __tablename__ = "salary_structures"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False, unique=True)
    basic: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    hra: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    special_allowance: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    pf_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=12, nullable=False)
    esi_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=0.75, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped["Employee"] = relationship()  # noqa: F821


class Payslip(Base):
    __tablename__ = "payslips"
    __table_args__ = (UniqueConstraint("employee_id", "month", "year", name="uq_payslip_employee_month_year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    basic: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    hra: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    special_allowance: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    gross_pay: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    pf_deduction: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    esi_deduction: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    professional_tax: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    net_pay: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    generated_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    employee: Mapped["Employee"] = relationship()  # noqa: F821

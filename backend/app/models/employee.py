import enum
from datetime import date, datetime

from sqlalchemy import ARRAY, Date, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Gender(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class EmployeeStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ON_NOTICE = "on_notice"
    EXITED = "exited"


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    employee_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)

    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(500))
    dob: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[Gender | None] = mapped_column(
        Enum(Gender, name="gender_enum", values_callable=lambda obj: [e.value for e in obj])
    )

    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("designations.id"))
    reporting_manager_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))

    joining_date: Mapped[date | None] = mapped_column(Date)
    skills: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    experience_years: Mapped[int | None] = mapped_column(Integer)
    photo_url: Mapped[str | None] = mapped_column(String(500))

    pan_number: Mapped[str | None] = mapped_column(String(10))
    aadhaar_number: Mapped[str | None] = mapped_column(String(12))
    bank_account_number: Mapped[str | None] = mapped_column(String(30))
    bank_ifsc: Mapped[str | None] = mapped_column(String(11))
    bank_name: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[EmployeeStatus] = mapped_column(
        Enum(EmployeeStatus, name="employee_status_enum", values_callable=lambda obj: [e.value for e in obj]),
        default=EmployeeStatus.ACTIVE,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="employee")  # noqa: F821
    department: Mapped["Department | None"] = relationship(back_populates="employees")  # noqa: F821
    designation: Mapped["Designation | None"] = relationship(back_populates="employees")  # noqa: F821
    reporting_manager: Mapped["Employee | None"] = relationship(
        remote_side=[id], back_populates="direct_reports"
    )
    direct_reports: Mapped[list["Employee"]] = relationship(back_populates="reporting_manager")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

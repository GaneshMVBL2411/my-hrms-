import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AssetCategory(str, enum.Enum):
    LAPTOP = "laptop"
    MONITOR = "monitor"
    KEYBOARD = "keyboard"
    MOUSE = "mouse"
    MOBILE = "mobile"
    ACCESSORY = "accessory"
    OTHER = "other"


class AssetStatus(str, enum.Enum):
    AVAILABLE = "available"
    ASSIGNED = "assigned"
    RETIRED = "retired"
    MAINTENANCE = "maintenance"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[AssetCategory] = mapped_column(
        Enum(AssetCategory, name="asset_category_enum", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    serial_number: Mapped[str | None] = mapped_column(String(100), unique=True)
    purchase_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[AssetStatus] = mapped_column(
        Enum(AssetStatus, name="asset_status_enum", values_callable=lambda obj: [e.value for e in obj]),
        default=AssetStatus.AVAILABLE,
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assignments: Mapped[list["AssetAssignment"]] = relationship(
        back_populates="asset", order_by="AssetAssignment.assigned_date.desc()"
    )


class AssetAssignment(Base):
    __tablename__ = "asset_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"), nullable=False)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    assigned_date: Mapped[date] = mapped_column(Date, nullable=False)
    returned_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(500))

    asset: Mapped["Asset"] = relationship(back_populates="assignments")
    employee: Mapped["Employee"] = relationship()  # noqa: F821

from datetime import date, datetime

from app.models.asset import AssetCategory, AssetStatus
from app.schemas.base import CamelModel


class AssetOut(CamelModel):
    id: int
    name: str
    category: AssetCategory
    serial_number: str | None
    purchase_date: date | None
    status: AssetStatus
    notes: str | None
    created_at: datetime
    assigned_to_name: str | None


class AssetCreate(CamelModel):
    name: str
    category: AssetCategory
    serial_number: str | None = None
    purchase_date: date | None = None
    notes: str | None = None


class AssetUpdate(CamelModel):
    name: str | None = None
    category: AssetCategory | None = None
    serial_number: str | None = None
    purchase_date: date | None = None
    status: AssetStatus | None = None
    notes: str | None = None


class AssetAssign(CamelModel):
    employee_id: int
    notes: str | None = None


class AssetAssignmentOut(CamelModel):
    id: int
    employee_id: int
    employee_name: str
    assigned_date: date
    returned_date: date | None
    notes: str | None


class PaginatedAssets(CamelModel):
    items: list[AssetOut]
    total: int
    page: int
    page_size: int

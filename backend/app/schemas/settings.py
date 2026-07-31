from datetime import datetime

from app.schemas.base import CamelModel


class CompanySettingsOut(CamelModel):
    id: int
    company_name: str
    address: str | None
    logo_url: str | None
    updated_at: datetime


class CompanySettingsUpdate(CamelModel):
    company_name: str
    address: str | None = None
    logo_url: str | None = None


class RoleOut(CamelModel):
    id: int
    name: str
    description: str | None
    permissions: list[str]


class AuditLogOut(CamelModel):
    id: int
    user_id: int | None
    user_name: str | None
    action: str
    entity: str
    entity_id: int | None
    created_at: datetime


class PaginatedAuditLogs(CamelModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int

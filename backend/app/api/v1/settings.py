from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.settings import (
    AuditLogOut,
    CompanySettingsOut,
    CompanySettingsUpdate,
    PaginatedAuditLogs,
    RoleOut,
)
from app.services import settings_service

router = APIRouter(tags=["settings"])


@router.get("/settings/company", response_model=CompanySettingsOut | None)
def get_company_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    settings = settings_service.get_company_settings(db)
    return CompanySettingsOut.model_validate(settings) if settings else None


@router.put("/settings/company", response_model=CompanySettingsOut)
def update_company_settings(
    payload: CompanySettingsUpdate, db: Session = Depends(get_db), _: User = Depends(require_roles("founder"))
):
    return settings_service.update_company_settings(db, payload)


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db), _: User = Depends(require_roles("founder", "hr_admin"))):
    return settings_service.list_roles(db)


@router.get("/audit-logs", response_model=PaginatedAuditLogs)
def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
    entity: str | None = Query(default=None),
    action: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("founder", "hr_admin")),
):
    logs, total = settings_service.list_audit_logs(db, page=page, page_size=page_size, entity=entity, action=action)
    return PaginatedAuditLogs(
        items=[settings_service.audit_log_to_out(log) for log in logs], total=total, page=page, page_size=page_size
    )

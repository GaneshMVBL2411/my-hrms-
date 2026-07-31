from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.audit_log import AuditLog
from app.models.company_settings import CompanySettings
from app.models.role import Role, RolePermission
from app.schemas.settings import AuditLogOut, CompanySettingsOut, CompanySettingsUpdate, RoleOut


def get_company_settings(db: Session) -> CompanySettings | None:
    return db.scalar(select(CompanySettings))


def update_company_settings(db: Session, payload: CompanySettingsUpdate) -> CompanySettingsOut:
    settings = get_company_settings(db)
    if not settings:
        settings = CompanySettings(**payload.model_dump())
        db.add(settings)
    else:
        for key, value in payload.model_dump().items():
            setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return CompanySettingsOut.model_validate(settings)


def list_roles(db: Session) -> list[RoleOut]:
    roles = db.scalars(
        select(Role).options(joinedload(Role.permissions).joinedload(RolePermission.permission)).order_by(Role.name)
    ).unique().all()
    return [
        RoleOut(
            id=r.id,
            name=r.name,
            description=r.description,
            permissions=[rp.permission.code for rp in r.permissions],
        )
        for r in roles
    ]


def list_audit_logs(
    db: Session, *, page: int, page_size: int, entity: str | None, action: str | None
) -> tuple[list[AuditLog], int]:
    query = select(AuditLog).options(joinedload(AuditLog.user))
    if entity:
        query = query.where(AuditLog.entity == entity)
    if action:
        query = query.where(AuditLog.action == action)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    logs = db.scalars(query).unique().all()
    return list(logs), total


def audit_log_to_out(log: AuditLog) -> AuditLogOut:
    user_name = None
    if log.user:
        user_name = log.user.employee.full_name if log.user.employee else log.user.email
    return AuditLogOut(
        id=log.id,
        user_id=log.user_id,
        user_name=user_name,
        action=log.action,
        entity=log.entity,
        entity_id=log.entity_id,
        created_at=log.created_at,
    )

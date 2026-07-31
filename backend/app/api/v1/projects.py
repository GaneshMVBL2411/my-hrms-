from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.project import (
    PaginatedProjects,
    ProjectCreate,
    ProjectMemberAdd,
    ProjectOut,
    ProjectUpdate,
)
from app.services import project_service

router = APIRouter(prefix="/projects", tags=["projects"])

MANAGE_ROLES = ("founder", "hr_admin", "project_manager")


@router.get("", response_model=PaginatedProjects)
def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100, alias="pageSize"),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    member_id: int | None = Query(default=None, alias="memberId"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = project_service.list_projects(
        db, page=page, page_size=page_size, status=status_filter, search=search, member_id=member_id
    )
    return PaginatedProjects(
        items=[project_service.to_summary(p) for p in items], total=total, page=page, page_size=page_size
    )


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    project = project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project_service.to_detail(project)


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    project = project_service.create_project(db, payload, created_by=user.id)
    db.add(AuditLog(user_id=user.id, action="create", entity="project", entity_id=project.id))
    db.commit()
    return project_service.to_detail(project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    project = project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    project = project_service.update_project(db, project, payload)
    db.add(AuditLog(user_id=user.id, action="update", entity="project", entity_id=project_id))
    db.commit()
    return project_service.to_detail(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    project = project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    project_service.delete_project(db, project)
    db.add(AuditLog(user_id=user.id, action="delete", entity="project", entity_id=project_id))
    db.commit()


@router.post("/{project_id}/members", response_model=ProjectOut)
def add_member(
    project_id: int,
    payload: ProjectMemberAdd,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    try:
        project = project_service.add_member(db, project_id, payload.employee_id, payload.role_in_project)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return project_service.to_detail(project)


@router.delete("/{project_id}/members/{employee_id}", response_model=ProjectOut)
def remove_member(
    project_id: int,
    employee_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    project = project_service.remove_member(db, project_id, employee_id)
    return project_service.to_detail(project)

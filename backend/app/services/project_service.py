from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.project import Project, ProjectMember
from app.schemas.project import ProjectCreate, ProjectMemberOut, ProjectOut, ProjectSummaryOut, ProjectUpdate


def _base_query():
    return select(Project).options(
        joinedload(Project.members).joinedload(ProjectMember.employee)
    )


def to_summary(project: Project) -> ProjectSummaryOut:
    return ProjectSummaryOut(
        id=project.id,
        name=project.name,
        priority=project.priority,
        status=project.status,
        deadline=project.deadline,
        progress=project.progress,
        tech_stack=project.tech_stack or [],
        member_count=len(project.members),
    )


def to_detail(project: Project) -> ProjectOut:
    return ProjectOut(
        **to_summary(project).model_dump(),
        description=project.description,
        created_at=project.created_at,
        members=[
            ProjectMemberOut(
                employee_id=m.employee_id,
                employee_name=m.employee.full_name,
                photo_url=m.employee.photo_url,
                role_in_project=m.role_in_project,
            )
            for m in project.members
        ],
    )


def list_projects(
    db: Session, *, page: int, page_size: int, status: str | None, search: str | None, member_id: int | None = None
) -> tuple[list[Project], int]:
    query = _base_query()
    if status:
        query = query.where(Project.status == status)
    if search:
        query = query.where(func.lower(Project.name).like(f"%{search.lower()}%"))
    if member_id:
        query = query.where(Project.members.any(ProjectMember.employee_id == member_id))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(Project.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    projects = db.scalars(query).unique().all()
    return list(projects), total


def get_project(db: Session, project_id: int) -> Project | None:
    return db.scalar(_base_query().where(Project.id == project_id))


def create_project(db: Session, payload: ProjectCreate, created_by: int) -> Project:
    project = Project(
        name=payload.name,
        description=payload.description,
        tech_stack=payload.tech_stack,
        priority=payload.priority,
        status=payload.status,
        deadline=payload.deadline,
        progress=payload.progress,
        created_by=created_by,
    )
    db.add(project)
    db.flush()

    for employee_id in payload.member_ids or []:
        db.add(ProjectMember(project_id=project.id, employee_id=employee_id))

    db.commit()
    return get_project(db, project.id)  # type: ignore[return-value]


def update_project(db: Session, project: Project, payload: ProjectUpdate) -> Project:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    db.commit()
    return get_project(db, project.id)  # type: ignore[return-value]


def delete_project(db: Session, project: Project) -> None:
    db.delete(project)
    db.commit()


def add_member(db: Session, project_id: int, employee_id: int, role_in_project: str | None) -> Project:
    existing = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.employee_id == employee_id
        )
    )
    if existing:
        raise ValueError("This employee is already a member of the project")

    db.add(ProjectMember(project_id=project_id, employee_id=employee_id, role_in_project=role_in_project))
    db.commit()
    return get_project(db, project_id)  # type: ignore[return-value]


def remove_member(db: Session, project_id: int, employee_id: int) -> Project:
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.employee_id == employee_id
        )
    )
    if member:
        db.delete(member)
        db.commit()
    return get_project(db, project_id)  # type: ignore[return-value]

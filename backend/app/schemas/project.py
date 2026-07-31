from datetime import date, datetime

from app.models.project import Priority, ProjectStatus
from app.schemas.base import CamelModel


class ProjectMemberOut(CamelModel):
    employee_id: int
    employee_name: str
    photo_url: str | None
    role_in_project: str | None


class ProjectSummaryOut(CamelModel):
    id: int
    name: str
    priority: Priority
    status: ProjectStatus
    deadline: date | None
    progress: int
    tech_stack: list[str]
    member_count: int


class ProjectOut(ProjectSummaryOut):
    description: str | None
    created_at: datetime
    members: list[ProjectMemberOut]


class ProjectCreate(CamelModel):
    name: str
    description: str | None = None
    tech_stack: list[str] | None = None
    priority: Priority = Priority.MEDIUM
    status: ProjectStatus = ProjectStatus.PLANNING
    deadline: date | None = None
    progress: int = 0
    member_ids: list[int] | None = None


class ProjectUpdate(CamelModel):
    name: str | None = None
    description: str | None = None
    tech_stack: list[str] | None = None
    priority: Priority | None = None
    status: ProjectStatus | None = None
    deadline: date | None = None
    progress: int | None = None


class ProjectMemberAdd(CamelModel):
    employee_id: int
    role_in_project: str | None = None


class PaginatedProjects(CamelModel):
    items: list[ProjectSummaryOut]
    total: int
    page: int
    page_size: int

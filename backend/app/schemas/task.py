from datetime import date, datetime

from pydantic import Field

from app.models.project import Priority
from app.models.task import TaskStatus
from app.schemas.base import CamelModel


class TaskChecklistItemOut(CamelModel):
    id: int
    label: str
    is_done: bool


class TaskChecklistItemCreate(CamelModel):
    label: str


class TaskCommentOut(CamelModel):
    id: int
    user_id: int
    user_name: str
    body: str
    created_at: datetime


class TaskCommentCreate(CamelModel):
    body: str


class TaskSummaryOut(CamelModel):
    id: int
    title: str
    project_id: int | None
    project_name: str | None
    assigned_to: int | None
    assignee_name: str | None
    priority: Priority
    due_date: date | None
    status: TaskStatus
    progress: int


class TaskOut(TaskSummaryOut):
    description: str | None
    created_at: datetime
    checklist_items: list[TaskChecklistItemOut]
    comments: list[TaskCommentOut]


class TaskCreate(CamelModel):
    title: str
    description: str | None = None
    project_id: int | None = None
    assigned_to: int | None = None
    priority: Priority = Priority.MEDIUM
    due_date: date | None = None
    status: TaskStatus = TaskStatus.ASSIGNED
    progress: int = Field(default=0, ge=0, le=100)


class TaskUpdate(CamelModel):
    title: str | None = None
    description: str | None = None
    project_id: int | None = None
    assigned_to: int | None = None
    priority: Priority | None = None
    due_date: date | None = None
    status: TaskStatus | None = None
    progress: int | None = Field(default=None, ge=0, le=100)


class PaginatedTasks(CamelModel):
    items: list[TaskSummaryOut]
    total: int
    page: int
    page_size: int

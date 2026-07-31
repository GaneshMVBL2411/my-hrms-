from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.task import TaskStatus
from app.models.user import User
from app.schemas.project import Priority
from app.schemas.task import (
    PaginatedTasks,
    TaskChecklistItemCreate,
    TaskCommentCreate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)
from app.services import task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])

MANAGE_ROLES = ("founder", "hr_admin", "project_manager", "team_lead")


@router.get("", response_model=PaginatedTasks)
def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
    project_id: int | None = Query(default=None, alias="projectId"),
    assigned_to: int | None = Query(default=None, alias="assignedTo"),
    status_filter: TaskStatus | None = Query(default=None, alias="status"),
    priority: Priority | None = Query(default=None),
    sort_by: str = Query("createdAt", alias="sortBy"),
    sort_dir: str = Query("desc", alias="sortDir"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = task_service.list_tasks(
        db,
        page=page,
        page_size=page_size,
        project_id=project_id,
        assigned_to=assigned_to,
        status=status_filter,
        priority=priority,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return PaginatedTasks(
        items=[task_service.to_summary(t) for t in items], total=total, page=page, page_size=page_size
    )


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    task = task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task_service.to_detail(task)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    task = task_service.create_task(db, payload, created_by=user.id)
    return task_service.to_detail(task)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    is_manager = user.role.name in MANAGE_ROLES
    fields_sent = payload.model_dump(exclude_unset=True).keys()

    if not is_manager:
        # Any employee can update status on any task (small-team collaboration),
        # but reassigning, retitling, etc. is still manager-only.
        if fields_sent - {"status", "progress"}:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only update a task's status and progress")

    if "progress" in fields_sent:
        # The completion percentage is self-reported by whoever is actually doing the
        # work — not even a manager can set it on someone else's behalf, only watch it.
        # An unassigned task simply has no one who can update it yet.
        is_assignee = user.employee is not None and task.assigned_to == user.employee.id
        if not is_assignee:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only the assignee can update a task's progress percentage"
            )

    task = task_service.update_task(db, task, payload)
    return task_service.to_detail(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    task = task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    task_service.delete_task(db, task)


@router.post("/{task_id}/checklist", response_model=TaskOut)
def add_checklist_item(
    task_id: int,
    payload: TaskChecklistItemCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    task = task_service.add_checklist_item(db, task_id, payload.label)
    return task_service.to_detail(task)


@router.patch("/checklist/{item_id}/toggle", response_model=TaskOut)
def toggle_checklist_item(item_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    try:
        task = task_service.toggle_checklist_item(db, item_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return task_service.to_detail(task)


@router.delete("/checklist/{item_id}", response_model=TaskOut)
def delete_checklist_item(item_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    try:
        task = task_service.delete_checklist_item(db, item_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return task_service.to_detail(task)


@router.post("/{task_id}/comments", response_model=TaskOut)
def add_comment(
    task_id: int,
    payload: TaskCommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = task_service.add_comment(db, task_id, user.id, payload.body)
    return task_service.to_detail(task)

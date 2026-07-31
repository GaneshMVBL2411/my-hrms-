from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.task import Task, TaskChecklistItem, TaskComment, TaskStatus
from app.models.user import User
from app.schemas.task import (
    TaskChecklistItemOut,
    TaskCommentOut,
    TaskCreate,
    TaskOut,
    TaskSummaryOut,
    TaskUpdate,
)
from app.services import notification_service

SORTABLE_COLUMNS = {
    "title": Task.title,
    "dueDate": Task.due_date,
    "priority": Task.priority,
    "status": Task.status,
    "createdAt": Task.created_at,
}


def _base_query():
    return select(Task).options(
        joinedload(Task.project),
        joinedload(Task.assignee),
        joinedload(Task.checklist_items),
        joinedload(Task.comments).joinedload(TaskComment.user).joinedload(User.employee),
    )


def to_summary(task: Task) -> TaskSummaryOut:
    return TaskSummaryOut(
        id=task.id,
        title=task.title,
        project_id=task.project_id,
        project_name=task.project.name if task.project else None,
        assigned_to=task.assigned_to,
        assignee_name=task.assignee.full_name if task.assignee else None,
        priority=task.priority,
        due_date=task.due_date,
        status=task.status,
        progress=task.progress,
    )


def to_detail(task: Task) -> TaskOut:
    return TaskOut(
        **to_summary(task).model_dump(),
        description=task.description,
        created_at=task.created_at,
        checklist_items=[
            TaskChecklistItemOut(id=i.id, label=i.label, is_done=i.is_done) for i in task.checklist_items
        ],
        comments=[
            TaskCommentOut(
                id=c.id,
                user_id=c.user_id,
                user_name=c.user.employee.full_name if c.user.employee else c.user.email,
                body=c.body,
                created_at=c.created_at,
            )
            for c in task.comments
        ],
    )


def list_tasks(
    db: Session,
    *,
    page: int,
    page_size: int,
    project_id: int | None,
    assigned_to: int | None,
    status: str | None,
    priority: str | None,
    sort_by: str,
    sort_dir: str,
) -> tuple[list[Task], int]:
    query = _base_query()
    if project_id:
        query = query.where(Task.project_id == project_id)
    if assigned_to:
        query = query.where(Task.assigned_to == assigned_to)
    if status:
        query = query.where(Task.status == status)
    if priority:
        query = query.where(Task.priority == priority)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0

    sort_col = SORTABLE_COLUMNS.get(sort_by, Task.created_at)
    order = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
    query = query.order_by(order).offset((page - 1) * page_size).limit(page_size)

    tasks = db.scalars(query).unique().all()
    return list(tasks), total


def get_task(db: Session, task_id: int) -> Task | None:
    return db.scalar(_base_query().where(Task.id == task_id))


def create_task(db: Session, payload: TaskCreate, created_by: int) -> Task:
    task = Task(
        title=payload.title,
        description=payload.description,
        project_id=payload.project_id,
        assigned_to=payload.assigned_to,
        priority=payload.priority,
        due_date=payload.due_date,
        status=payload.status,
        progress=100 if payload.status == TaskStatus.COMPLETED else payload.progress,
        created_by=created_by,
    )
    db.add(task)
    db.commit()

    if task.assigned_to:
        notification_service.notify_task_assigned(
            db, employee_id=task.assigned_to, task_title=task.title, due_date=task.due_date
        )

    return get_task(db, task.id)  # type: ignore[return-value]


def update_task(db: Session, task: Task, payload: TaskUpdate) -> Task:
    updates = payload.model_dump(exclude_unset=True)
    previous_assignee = task.assigned_to

    for key, value in updates.items():
        setattr(task, key, value)

    # Progress and status stay in sync: reaching 100% marks the task complete,
    # and marking it complete fills the progress bar.
    if "progress" in updates and task.progress >= 100:
        task.status = TaskStatus.COMPLETED
    elif "status" in updates and task.status == TaskStatus.COMPLETED:
        task.progress = 100

    db.commit()

    if "assigned_to" in updates and task.assigned_to and task.assigned_to != previous_assignee:
        notification_service.notify_task_assigned(
            db, employee_id=task.assigned_to, task_title=task.title, due_date=task.due_date
        )

    return get_task(db, task.id)  # type: ignore[return-value]


def delete_task(db: Session, task: Task) -> None:
    db.delete(task)
    db.commit()


def add_checklist_item(db: Session, task_id: int, label: str) -> Task:
    db.add(TaskChecklistItem(task_id=task_id, label=label))
    db.commit()
    return get_task(db, task_id)  # type: ignore[return-value]


def toggle_checklist_item(db: Session, item_id: int) -> Task:
    item = db.scalar(select(TaskChecklistItem).where(TaskChecklistItem.id == item_id))
    if not item:
        raise ValueError("Checklist item not found")
    item.is_done = not item.is_done
    db.commit()
    return get_task(db, item.task_id)  # type: ignore[return-value]


def delete_checklist_item(db: Session, item_id: int) -> Task:
    item = db.scalar(select(TaskChecklistItem).where(TaskChecklistItem.id == item_id))
    if not item:
        raise ValueError("Checklist item not found")
    task_id = item.task_id
    db.delete(item)
    db.commit()
    return get_task(db, task_id)  # type: ignore[return-value]


def add_comment(db: Session, task_id: int, user_id: int, body: str) -> Task:
    db.add(TaskComment(task_id=task_id, user_id=user_id, body=body))
    db.commit()
    return get_task(db, task_id)  # type: ignore[return-value]

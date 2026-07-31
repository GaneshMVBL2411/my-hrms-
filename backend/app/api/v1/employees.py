from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.db.storage import upload_file
from app.models.audit_log import AuditLog
from app.models.employee import EmployeeStatus
from app.models.user import User
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate, PaginatedEmployees
from app.services import employee_service

router = APIRouter(prefix="/employees", tags=["employees"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("", response_model=PaginatedEmployees)
def list_employees(
    page: int = Query(1, ge=1),
    # Higher ceiling than other list endpoints: several dropdowns (task/project
    # assignment, letter generation, salary structures) fetch the full employee
    # roster in one page rather than paginating, and the app is meant to scale
    # to 500+ employees.
    page_size: int = Query(10, ge=1, le=1000, alias="pageSize"),
    search: str | None = Query(None, alias="search"),
    department_id: int | None = Query(None, alias="departmentId"),
    designation_id: int | None = Query(None, alias="designationId"),
    status_filter: EmployeeStatus | None = Query(None, alias="status"),
    sort_by: str = Query("fullName", alias="sortBy"),
    sort_dir: str = Query("asc", alias="sortDir"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = employee_service.list_employees(
        db,
        page=page,
        page_size=page_size,
        search=search,
        department_id=department_id,
        designation_id=designation_id,
        status=status_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return PaginatedEmployees(
        items=[employee_service.to_summary(e) for e in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    employee = employee_service.get_employee(db, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return employee_service.to_detail(employee)


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    try:
        employee = employee_service.create_employee(db, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    db.add(AuditLog(user_id=current_user.id, action="create", entity="employee", entity_id=employee.id))
    db.commit()
    return employee_service.to_detail(employee)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    employee = employee_service.get_employee(db, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    try:
        employee = employee_service.update_employee(db, employee, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    db.add(AuditLog(user_id=current_user.id, action="update", entity="employee", entity_id=employee.id))
    db.commit()
    return employee_service.to_detail(employee)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    employee = employee_service.get_employee(db, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    if employee.user_id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate your own account")

    employee_service.delete_employee(db, employee)
    db.add(AuditLog(user_id=current_user.id, action="deactivate", entity="employee", entity_id=employee.id))
    db.commit()


@router.post("/{employee_id}/photo")
async def upload_photo(
    employee_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    employee = employee_service.get_employee(db, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    content = await file.read()
    path = f"employees/{employee_id}/photo-{file.filename}"
    photo_url = upload_file(path, content, file.content_type or "application/octet-stream")

    employee.photo_url = photo_url
    db.commit()

    return {"photo_url": photo_url}

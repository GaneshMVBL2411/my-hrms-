from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.department import Department
from app.models.user import User
from app.schemas.employee import DepartmentCreate, DepartmentOut, DepartmentUpdate
from app.services import employee_service

router = APIRouter(prefix="/departments", tags=["departments"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return employee_service.list_departments(db)


@router.post("", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    return employee_service.create_department(db, payload.name, payload.description)


@router.patch("/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    return employee_service.update_department(db, department, payload.model_dump(exclude_unset=True))


@router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    employee_service.delete_department(db, department)

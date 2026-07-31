from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.designation import Designation
from app.models.user import User
from app.schemas.employee import DesignationCreate, DesignationOut, DesignationUpdate
from app.services import employee_service

router = APIRouter(prefix="/designations", tags=["designations"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("", response_model=list[DesignationOut])
def list_designations(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return employee_service.list_designations(db)


@router.post("", response_model=DesignationOut, status_code=status.HTTP_201_CREATED)
def create_designation(
    payload: DesignationCreate, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    return employee_service.create_designation(db, payload.title, payload.description)


@router.patch("/{designation_id}", response_model=DesignationOut)
def update_designation(
    designation_id: int,
    payload: DesignationUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    designation = db.get(Designation, designation_id)
    if not designation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Designation not found")
    return employee_service.update_designation(db, designation, payload.model_dump(exclude_unset=True))


@router.delete("/{designation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_designation(
    designation_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    designation = db.get(Designation, designation_id)
    if not designation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Designation not found")
    employee_service.delete_designation(db, designation)

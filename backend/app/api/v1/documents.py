from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.document import (
    GeneratedLetterOut,
    LetterGenerateRequest,
    LetterPayload,
    PolicyCreate,
    PolicyOut,
    PolicyUpdate,
)
from app.services import document_service

router = APIRouter(tags=["documents"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("/policies", response_model=list[PolicyOut])
def list_policies(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return document_service.list_policies(db)


@router.post("/policies", response_model=PolicyOut, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: PolicyCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*MANAGE_ROLES))
):
    return document_service.create_policy(db, payload, user.id)


@router.patch("/policies/{policy_id}", response_model=PolicyOut)
def update_policy(
    policy_id: int,
    payload: PolicyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    policy = document_service.get_policy(db, policy_id)
    if not policy:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    return document_service.update_policy(db, policy, payload, user.id)


@router.delete("/policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    policy_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    policy = document_service.get_policy(db, policy_id)
    if not policy:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    document_service.delete_policy(db, policy)


@router.get("/letters", response_model=list[GeneratedLetterOut])
def list_letters(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    is_manager = user.role.name in MANAGE_ROLES
    if is_manager:
        return document_service.list_letters(db)
    if not user.employee:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No employee profile linked to this account")
    return document_service.list_letters(db, employee_id=user.employee.id)


@router.post("/letters/generate", response_model=LetterPayload)
def generate_letter(
    payload: LetterGenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    try:
        return document_service.generate_letter(db, payload, user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.get("/letters/{letter_id}/view", response_model=LetterPayload)
def view_letter(letter_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = document_service.get_letter(db, letter_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Letter not found")

    is_manager = user.role.name in MANAGE_ROLES
    if not is_manager and (not user.employee or record.employee_id != user.employee.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to perform this action")

    return document_service.get_letter_view(db, letter_id)

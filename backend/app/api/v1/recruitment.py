from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.recruitment import (
    CandidateCreate,
    CandidateOut,
    CandidateUpdate,
    InterviewCreate,
    InterviewUpdate,
    PaginatedCandidates,
)
from app.services import recruitment_service

router = APIRouter(prefix="/candidates", tags=["recruitment"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("", response_model=PaginatedCandidates)
def list_candidates(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100, alias="pageSize"),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    items, total = recruitment_service.list_candidates(
        db, page=page, page_size=page_size, status=status_filter, search=search
    )
    return PaginatedCandidates(
        items=[recruitment_service.to_summary(c) for c in items], total=total, page=page, page_size=page_size
    )


@router.get("/{candidate_id}", response_model=CandidateOut)
def get_candidate(
    candidate_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    candidate = recruitment_service.get_candidate(db, candidate_id)
    if not candidate:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found")
    return recruitment_service.to_detail(candidate)


@router.post("", response_model=CandidateOut, status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: CandidateCreate, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    candidate = recruitment_service.create_candidate(db, payload)
    return recruitment_service.to_detail(candidate)


@router.patch("/{candidate_id}", response_model=CandidateOut)
def update_candidate(
    candidate_id: int,
    payload: CandidateUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    candidate = recruitment_service.get_candidate(db, candidate_id)
    if not candidate:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found")
    candidate = recruitment_service.update_candidate(db, candidate, payload)
    return recruitment_service.to_detail(candidate)


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    candidate = recruitment_service.get_candidate(db, candidate_id)
    if not candidate:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found")
    recruitment_service.delete_candidate(db, candidate)


@router.post("/{candidate_id}/interviews", response_model=CandidateOut)
def add_interview(
    candidate_id: int,
    payload: InterviewCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    candidate = recruitment_service.get_candidate(db, candidate_id)
    if not candidate:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found")
    return recruitment_service.to_detail(recruitment_service.add_interview(db, candidate_id, payload))


@router.patch("/interviews/{interview_id}", response_model=CandidateOut)
def update_interview(
    interview_id: int,
    payload: InterviewUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    try:
        candidate = recruitment_service.update_interview(db, interview_id, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return recruitment_service.to_detail(candidate)

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.recruitment import Candidate, Interview
from app.schemas.recruitment import (
    CandidateCreate,
    CandidateOut,
    CandidateSummaryOut,
    CandidateUpdate,
    InterviewCreate,
    InterviewOut,
    InterviewUpdate,
)


def _base_query():
    return select(Candidate).options(
        joinedload(Candidate.applied_designation),
        joinedload(Candidate.interviews).joinedload(Interview.interviewer),
    )


def to_summary(candidate: Candidate) -> CandidateSummaryOut:
    return CandidateSummaryOut(
        id=candidate.id,
        full_name=candidate.full_name,
        email=candidate.email,
        phone=candidate.phone,
        applied_designation_id=candidate.applied_designation_id,
        applied_designation_title=candidate.applied_designation.title if candidate.applied_designation else None,
        status=candidate.status,
        created_at=candidate.created_at,
    )


def to_detail(candidate: Candidate) -> CandidateOut:
    return CandidateOut(
        **to_summary(candidate).model_dump(),
        source=candidate.source,
        notes=candidate.notes,
        interviews=[
            InterviewOut(
                id=i.id,
                scheduled_at=i.scheduled_at,
                interviewer_id=i.interviewer_id,
                interviewer_name=i.interviewer.full_name if i.interviewer else None,
                notes=i.notes,
                outcome=i.outcome,
            )
            for i in candidate.interviews
        ],
    )


def list_candidates(
    db: Session, *, page: int, page_size: int, status: str | None, search: str | None
) -> tuple[list[Candidate], int]:
    query = _base_query()
    if status:
        query = query.where(Candidate.status == status)
    if search:
        pattern = f"%{search.lower()}%"
        query = query.where(func.lower(Candidate.full_name).like(pattern) | func.lower(Candidate.email).like(pattern))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(Candidate.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    candidates = db.scalars(query).unique().all()
    return list(candidates), total


def get_candidate(db: Session, candidate_id: int) -> Candidate | None:
    return db.scalar(_base_query().where(Candidate.id == candidate_id))


def create_candidate(db: Session, payload: CandidateCreate) -> Candidate:
    candidate = Candidate(**payload.model_dump())
    db.add(candidate)
    db.commit()
    return get_candidate(db, candidate.id)  # type: ignore[return-value]


def update_candidate(db: Session, candidate: Candidate, payload: CandidateUpdate) -> Candidate:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(candidate, key, value)
    db.commit()
    return get_candidate(db, candidate.id)  # type: ignore[return-value]


def delete_candidate(db: Session, candidate: Candidate) -> None:
    db.delete(candidate)
    db.commit()


def add_interview(db: Session, candidate_id: int, payload: InterviewCreate) -> Candidate:
    db.add(Interview(candidate_id=candidate_id, **payload.model_dump()))
    candidate = get_candidate(db, candidate_id)
    if candidate and candidate.status == "applied":
        candidate.status = "interview_scheduled"
    db.commit()
    return get_candidate(db, candidate_id)  # type: ignore[return-value]


def update_interview(db: Session, interview_id: int, payload: InterviewUpdate) -> Candidate:
    interview = db.scalar(select(Interview).where(Interview.id == interview_id))
    if not interview:
        raise ValueError("Interview not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(interview, key, value)
    db.commit()
    return get_candidate(db, interview.candidate_id)  # type: ignore[return-value]

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.announcement import Announcement
from app.schemas.announcement import AnnouncementCreate, AnnouncementOut, AnnouncementUpdate
from app.services import notification_service


def _to_out(announcement: Announcement) -> AnnouncementOut:
    return AnnouncementOut(
        id=announcement.id,
        title=announcement.title,
        body=announcement.body,
        category=announcement.category,
        pinned=announcement.pinned,
        created_by_name=announcement.creator.employee.full_name
        if announcement.creator.employee
        else announcement.creator.email,
        created_at=announcement.created_at,
    )


def list_announcements(db: Session) -> list[AnnouncementOut]:
    announcements = db.scalars(
        select(Announcement)
        .options(joinedload(Announcement.creator))
        .order_by(Announcement.pinned.desc(), Announcement.created_at.desc())
    ).all()
    return [_to_out(a) for a in announcements]


def get_announcement(db: Session, announcement_id: int) -> Announcement | None:
    return db.scalar(
        select(Announcement).options(joinedload(Announcement.creator)).where(Announcement.id == announcement_id)
    )


def create_announcement(db: Session, payload: AnnouncementCreate, created_by: int) -> AnnouncementOut:
    announcement = Announcement(**payload.model_dump(), created_by=created_by)
    db.add(announcement)
    db.commit()

    notification_service.notify_announcement(db, title=announcement.title, body=announcement.body)

    return _to_out(get_announcement(db, announcement.id))  # type: ignore[arg-type]


def update_announcement(db: Session, announcement: Announcement, payload: AnnouncementUpdate) -> AnnouncementOut:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(announcement, key, value)
    db.commit()
    return _to_out(get_announcement(db, announcement.id))  # type: ignore[arg-type]


def delete_announcement(db: Session, announcement: Announcement) -> None:
    db.delete(announcement)
    db.commit()

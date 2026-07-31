from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.announcement import Announcement
from app.models.user import User
from app.schemas.announcement import AnnouncementCreate, AnnouncementOut, AnnouncementUpdate
from app.services import announcement_service

router = APIRouter(prefix="/announcements", tags=["announcements"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("", response_model=list[AnnouncementOut])
def list_announcements(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return announcement_service.list_announcements(db)


@router.post("", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
def create_announcement(
    payload: AnnouncementCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*MANAGE_ROLES))
):
    return announcement_service.create_announcement(db, payload, user.id)


@router.patch("/{announcement_id}", response_model=AnnouncementOut)
def update_announcement(
    announcement_id: int,
    payload: AnnouncementUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    announcement = db.get(Announcement, announcement_id)
    if not announcement:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found")
    return announcement_service.update_announcement(db, announcement, payload)


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    announcement = db.get(Announcement, announcement_id)
    if not announcement:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found")
    announcement_service.delete_announcement(db, announcement)

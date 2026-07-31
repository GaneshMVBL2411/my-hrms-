from datetime import datetime

from app.models.announcement import AnnouncementCategory
from app.schemas.base import CamelModel


class AnnouncementOut(CamelModel):
    id: int
    title: str
    body: str
    category: AnnouncementCategory
    pinned: bool
    created_by_name: str
    created_at: datetime


class AnnouncementCreate(CamelModel):
    title: str
    body: str
    category: AnnouncementCategory = AnnouncementCategory.GENERAL
    pinned: bool = False


class AnnouncementUpdate(CamelModel):
    title: str | None = None
    body: str | None = None
    category: AnnouncementCategory | None = None
    pinned: bool | None = None

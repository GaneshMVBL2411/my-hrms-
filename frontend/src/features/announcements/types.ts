export type AnnouncementCategory = "news" | "holiday" | "event" | "general"

export interface Announcement {
  id: number
  title: string
  body: string
  category: AnnouncementCategory
  pinned: boolean
  createdByName: string
  createdAt: string
}

export interface AnnouncementCreate {
  title: string
  body: string
  category: AnnouncementCategory
  pinned: boolean
}

export type AnnouncementUpdate = Partial<AnnouncementCreate>

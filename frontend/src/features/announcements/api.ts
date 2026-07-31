import { apiClient } from "@/lib/apiClient"
import type { Announcement, AnnouncementCreate, AnnouncementUpdate } from "@/features/announcements/types"

export async function listAnnouncements(): Promise<Announcement[]> {
  const { data } = await apiClient.get("/announcements")
  return data
}

export async function createAnnouncement(payload: AnnouncementCreate): Promise<Announcement> {
  const { data } = await apiClient.post("/announcements", payload)
  return data
}

export async function updateAnnouncement(id: number, payload: AnnouncementUpdate): Promise<Announcement> {
  const { data } = await apiClient.patch(`/announcements/${id}`, payload)
  return data
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await apiClient.delete(`/announcements/${id}`)
}

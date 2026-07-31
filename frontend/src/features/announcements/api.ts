import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid } from "@/lib/errors"
import { definedOnly } from "@/lib/case"
import type { Announcement, AnnouncementCreate, AnnouncementUpdate } from "@/features/announcements/types"

const COLUMNS = "id, title, body, category, pinned, created_by_name, created_at"

async function getAnnouncement(id: number): Promise<Announcement> {
  return unwrap<Announcement>(
    await supabase.from("announcement_detail").select(COLUMNS).eq("id", id).single()
  )
}

export async function listAnnouncements(): Promise<Announcement[]> {
  return unwrap<Announcement[]>(
    await supabase
      .from("announcement_detail")
      .select(COLUMNS)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
  )
}

export async function createAnnouncement(payload: AnnouncementCreate): Promise<Announcement> {
  const created = unwrap<{ id: number }>(
    await supabase.from("announcements").insert(definedOnly(payload)).select("id").single()
  )
  return getAnnouncement(created.id)
}

export async function updateAnnouncement(id: number, payload: AnnouncementUpdate): Promise<Announcement> {
  unwrapVoid(await supabase.from("announcements").update(definedOnly(payload)).eq("id", id))
  return getAnnouncement(id)
}

export async function deleteAnnouncement(id: number): Promise<void> {
  unwrapVoid(await supabase.from("announcements").delete().eq("id", id))
}

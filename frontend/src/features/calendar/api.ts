import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid } from "@/lib/errors"
import { definedOnly } from "@/lib/case"
import type { CalendarEntry, CompanyEvent, CompanyEventCreate } from "@/features/calendar/types"

const EVENT_COLUMNS = "id, title, description, event_date, event_type, created_by_name"

/** Merges events, approved leave, task and project deadlines, and birthdays. */
export async function getCalendar(year: number, month: number): Promise<CalendarEntry[]> {
  return unwrap<CalendarEntry[]>(await supabase.rpc("get_calendar", { p_year: year, p_month: month }))
}

export async function createEvent(payload: CompanyEventCreate): Promise<CompanyEvent> {
  const created = unwrap<{ id: number }>(
    await supabase
      .from("company_events")
      .insert(
        definedOnly({
          title: payload.title,
          description: payload.description,
          event_date: payload.eventDate,
          event_type: payload.eventType,
        })
      )
      .select("id")
      .single()
  )

  return unwrap<CompanyEvent>(
    await supabase.from("company_event_detail").select(EVENT_COLUMNS).eq("id", created.id).single()
  )
}

export async function deleteEvent(id: number): Promise<void> {
  unwrapVoid(await supabase.from("company_events").delete().eq("id", id))
}

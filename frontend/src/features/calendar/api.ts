import { apiClient } from "@/lib/apiClient"
import type { CalendarEntry, CompanyEvent, CompanyEventCreate } from "@/features/calendar/types"

export async function getCalendar(year: number, month: number): Promise<CalendarEntry[]> {
  const { data } = await apiClient.get("/calendar", { params: { year, month } })
  return data
}

export async function createEvent(payload: CompanyEventCreate): Promise<CompanyEvent> {
  const { data } = await apiClient.post("/calendar/events", payload)
  return data
}

export async function deleteEvent(id: number): Promise<void> {
  await apiClient.delete(`/calendar/events/${id}`)
}

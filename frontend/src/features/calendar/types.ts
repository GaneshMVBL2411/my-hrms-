export type EventType = "meeting" | "event" | "holiday"
export type CalendarEntryType = EventType | "leave" | "task_due" | "project_deadline" | "birthday"

export interface CalendarEntry {
  date: string
  type: CalendarEntryType
  title: string
}

export interface CompanyEvent {
  id: number
  title: string
  description: string | null
  eventDate: string
  eventType: EventType
  createdByName: string
}

export interface CompanyEventCreate {
  title: string
  description?: string
  eventDate: string
  eventType: EventType
}

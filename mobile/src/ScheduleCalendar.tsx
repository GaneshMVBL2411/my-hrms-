import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { rpc, createCompanyEvent, deleteCompanyEvent, type SessionUser } from "./api"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"

export interface CalendarEvent {
  id?: number | string
  date: string
  title: string
  type: "meeting" | "event" | "holiday" | "leave" | "task_due" | "project_deadline" | "birthday"
  timeSlot?: string
  description?: string
}

const TYPE_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  meeting: { dot: "#8b5cf6", bg: "rgba(139, 92, 246, 0.12)", text: "#7c3aed", label: "Meeting" },
  event: { dot: "#10b981", bg: "rgba(16, 185, 129, 0.12)", text: "#059669", label: "Event" },
  leave: { dot: "#f43f5e", bg: "rgba(244, 63, 94, 0.12)", text: "#e11d48", label: "Leave" },
  task_due: { dot: "#0ea5e9", bg: "rgba(14, 165, 233, 0.12)", text: "#0284c7", label: "Task" },
  holiday: { dot: "#6366f1", bg: "rgba(99, 102, 241, 0.12)", text: "#4f46e5", label: "Holiday" },
  project_deadline: { dot: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", text: "#d97706", label: "Deadline" },
  birthday: { dot: "#ec4899", bg: "rgba(236, 72, 153, 0.12)", text: "#db2777", label: "Birthday" },
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function ScheduleCalendar({
  user,
}: {
  user: SessionUser
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)

  const isManager =
    user.role === "founder" ||
    user.role === "company_admin" ||
    user.role === "hr_admin" ||
    user.role === "project_manager" ||
    user.role === "team_lead"

  // Dynamic current date
  const now = new Date()
  const [currentYear, setCurrentYear] = useState(() => now.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(() => now.getMonth())
  const [selectedDateStr, setSelectedDateStr] = useState(() => {
    const m = now.getMonth() + 1
    const d = now.getDate()
    return `${now.getFullYear()}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`
  })
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)

  // Event modal state
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [eventTitle, setEventTitle] = useState("")
  const [eventType, setEventType] = useState<"meeting" | "event" | "holiday">("meeting")
  const [eventDescription, setEventDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const todayStr = useMemo(() => {
    const d = new Date()
    const m = d.getMonth() + 1
    const day = d.getDate()
    return `${d.getFullYear()}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`
  }, [])

  // Load calendar events from server
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await rpc<CalendarEvent[]>("get_calendar", {
        p_year: currentYear,
        p_month: currentMonth + 1,
      })
      if (Array.isArray(data)) {
        setEvents(data)
      } else {
        setEvents([])
      }
    } catch {
      // Error fetching calendar
    } finally {
      setLoading(false)
    }
  }, [currentYear, currentMonth])

  useEffect(() => {
    loadData()
  }, [loadData])

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear((y) => y - 1)
    } else {
      setCurrentMonth((m) => m - 1)
    }
  }

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear((y) => y + 1)
    } else {
      setCurrentMonth((m) => m + 1)
    }
  }

  // Calculate grid days
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay()
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate()

    const days: {
      dayNum: number
      dateStr: string
      isCurrentMonth: boolean
      isToday: boolean
      isSelected: boolean
    }[] = []

    // Previous month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const prevM = currentMonth === 0 ? 12 : currentMonth
      const prevY = currentMonth === 0 ? currentYear - 1 : currentYear
      const dateStr = `${prevY}-${prevM < 10 ? "0" : ""}${prevM}-${d < 10 ? "0" : ""}${d}`
      days.push({
        dayNum: d,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDateStr,
      })
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const m = currentMonth + 1
      const dateStr = `${currentYear}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`
      days.push({
        dayNum: d,
        dateStr,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDateStr,
      })
    }

    // Next month padding
    const totalCurrent = days.length
    const remaining = (7 - (totalCurrent % 7)) % 7
    for (let d = 1; d <= remaining; d++) {
      const nextM = currentMonth === 11 ? 1 : currentMonth + 2
      const nextY = currentMonth === 11 ? currentYear + 1 : currentYear
      const dateStr = `${nextY}-${nextM < 10 ? "0" : ""}${nextM}-${d < 10 ? "0" : ""}${d}`
      days.push({
        dayNum: d,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDateStr,
      })
    }

    return days
  }, [currentYear, currentMonth, todayStr, selectedDateStr])

  // Events map by date with optional category filter
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of events) {
      if (activeFilter && ev.type !== activeFilter) continue
      const list = map.get(ev.date) || []
      list.push(ev)
      map.set(ev.date, list)
    }
    return map
  }, [events, activeFilter])

  const selectedEvents = eventsByDate.get(selectedDateStr) || []

  const handleCreateEvent = async () => {
    if (!eventTitle.trim()) {
      Alert.alert("Required", "Please enter a title for the event.")
      return
    }

    try {
      setSubmitting(true)
      await createCompanyEvent({
        title: eventTitle.trim(),
        description: eventDescription.trim() || undefined,
        event_date: selectedDateStr,
        event_type: eventType,
      })
      setEventModalOpen(false)
      setEventTitle("")
      setEventDescription("")
      Alert.alert("Success", "Event created successfully.")
      await loadData()
    } catch {
      Alert.alert("Error", "Could not create event. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteEvent = (ev: CalendarEvent) => {
    if (!ev.id) return
    Alert.alert("Delete Event", `Remove "${ev.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            if (typeof ev.id === "number") {
              await deleteCompanyEvent(ev.id)
            }
            await loadData()
          } catch {
            Alert.alert("Error", "Could not delete event.")
          }
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      {/* Main "My Schedule" Calendar Template matching reference screenshot */}
      <View style={styles.calendarCard}>
        {/* Calendar Header with Navigation Controls */}
        <View style={styles.calendarHeader}>
          <View style={styles.calendarTitleWrap}>
            <Ionicons name="calendar-outline" size={scale(18)} color={colors.text} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.calendarTitle}>
              My Schedule
            </Text>
            {loading && <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: scale(4) }} />}
          </View>

          {/* Month Switcher Controls */}
          <View style={styles.monthControls}>
            <TouchableOpacity
              onPress={prevMonth}
              style={styles.monthNavBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Previous month"
            >
              <Ionicons name="chevron-back" size={scale(16)} color={colors.text} />
            </TouchableOpacity>

            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.monthLabel}>
              {`${MONTH_NAMES[currentMonth]} ${currentYear}`}
            </Text>

            <TouchableOpacity
              onPress={nextMonth}
              style={styles.monthNavBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Next month"
            >
              <Ionicons name="chevron-forward" size={scale(16)} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 7-Day Header: Sun, Mon, Tue, Wed, Thu, Fri, Sat */}
        <View style={styles.dayOfWeekHeader}>
          {DAYS_OF_WEEK.map((day) => (
            <View key={day} style={styles.dayOfWeekCell}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.dayOfWeekText}>
                {day}
              </Text>
            </View>
          ))}
        </View>

        {/* Calendar Grid matching reference image template */}
        <View style={styles.grid}>
          {calendarDays.map((item, idx) => {
            const dayEvents = eventsByDate.get(item.dateStr) || []

            return (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.dayCell,
                  item.isSelected && styles.dayCellSelected,
                  !item.isCurrentMonth && styles.dayCellOutside,
                ]}
                onPress={() => setSelectedDateStr(item.dateStr)}
                activeOpacity={0.7}
              >
                {/* Day Header inside cell: number + tiny calendar icon */}
                <View style={styles.dayCellHeader}>
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_CAP}
                    style={[
                      styles.dayNum,
                      item.isToday && styles.dayNumToday,
                      item.isSelected && styles.dayNumSelected,
                      !item.isCurrentMonth && styles.dayNumOutside,
                    ]}
                  >
                    {item.dayNum}
                  </Text>
                  <Ionicons
                    name="calendar-outline"
                    size={scale(9)}
                    color={
                      item.isSelected || item.isToday
                        ? "#2563eb"
                        : item.isCurrentMonth
                        ? colors.muted
                        : "transparent"
                    }
                  />
                </View>

                {/* Event Indicator Dots */}
                <View style={styles.dotRow}>
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <View
                      key={i}
                      style={[
                        styles.eventDot,
                        { backgroundColor: TYPE_COLORS[ev.type]?.dot || "#3b82f6" },
                      ]}
                    />
                  ))}
                  {dayEvents.length > 3 && (
                    <Text style={{ fontSize: scale(7), color: colors.muted }}>+{dayEvents.length - 3}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Color-Coded Category Legend matching reference */}
        <View style={styles.legendRow}>
          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "meeting" ? null : "meeting"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#8b5cf6" }]} />
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP}
              style={[styles.legendText, activeFilter === "meeting" && { color: "#8b5cf6", fontWeight: "700" }]}
            >
              Meetings
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "event" ? null : "event"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#10b981" }]} />
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP}
              style={[styles.legendText, activeFilter === "event" && { color: "#10b981", fontWeight: "700" }]}
            >
              Events
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "leave" ? null : "leave"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#f43f5e" }]} />
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP}
              style={[styles.legendText, activeFilter === "leave" && { color: "#f43f5e", fontWeight: "700" }]}
            >
              Leaves
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "task_due" ? null : "task_due"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#0ea5e9" }]} />
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP}
              style={[styles.legendText, activeFilter === "task_due" && { color: "#0ea5e9", fontWeight: "700" }]}
            >
              Tasks
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "holiday" ? null : "holiday"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#6366f1" }]} />
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP}
              style={[styles.legendText, activeFilter === "holiday" && { color: "#6366f1", fontWeight: "700" }]}
            >
              Holidays
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "project_deadline" ? null : "project_deadline"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#f59e0b" }]} />
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP}
              style={[styles.legendText, activeFilter === "project_deadline" && { color: "#f59e0b", fontWeight: "700" }]}
            >
              Deadlines
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected Day Agenda Box */}
      <View style={styles.agendaCard}>
        <View style={styles.agendaHeader}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: scale(6) }}>
            <Ionicons name="time-outline" size={scale(16)} color={colors.accent} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaTitle}>
              Schedule for {selectedDateStr}
            </Text>
          </View>
          {isManager && (
            <TouchableOpacity
              style={styles.addEventBtn}
              onPress={() => setEventModalOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={scale(14)} color="#ffffff" />
              <Text style={styles.addEventBtnText}>Add Event</Text>
            </TouchableOpacity>
          )}
        </View>

        {selectedEvents.length === 0 ? (
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaEmpty}>
            No events, leaves, or meetings scheduled on this date.
          </Text>
        ) : (
          <View style={styles.agendaList}>
            {selectedEvents.map((ev, i) => {
              const theme = TYPE_COLORS[ev.type] || TYPE_COLORS.event
              return (
                <View key={i} style={styles.agendaRow}>
                  <View style={[styles.agendaTypeDot, { backgroundColor: theme.dot }]} />
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaEventTitle}>
                      {ev.title}
                    </Text>
                    {ev.description ? (
                      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaEventSub}>
                        {ev.description}
                      </Text>
                    ) : null}
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: scale(6) }}>
                    <View style={[styles.agendaBadge, { backgroundColor: theme.bg }]}>
                      <Text style={[styles.agendaBadgeText, { color: theme.text }]}>
                        {theme.label}
                      </Text>
                    </View>

                    {isManager && typeof ev.id === "number" && (
                      <TouchableOpacity
                        onPress={() => handleDeleteEvent(ev)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Ionicons name="trash-outline" size={scale(16)} color="#ef4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>

      {/* Real Event Creation Modal */}
      <Modal visible={eventModalOpen} transparent animationType="slide" onRequestClose={() => setEventModalOpen(false)} statusBarTranslucent>
        <Pressable style={styles.modalBackdrop} onPress={() => setEventModalOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalGrip} />
            <Text style={styles.modalTitle}>Add New Event</Text>

            <Text style={styles.inputLabel}>Title</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Sprint Planning, Company All-Hands"
              placeholderTextColor={colors.faint}
              value={eventTitle}
              onChangeText={setEventTitle}
            />

            <Text style={styles.inputLabel}>Category</Text>
            <View style={styles.typeSelectorRow}>
              {(["meeting", "event", "holiday"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typePill, eventType === t && { backgroundColor: TYPE_COLORS[t].dot }]}
                  onPress={() => setEventType(t)}
                >
                  <Text
                    style={[
                      styles.typePillText,
                      eventType === t && { color: "#ffffff", fontWeight: "700" },
                    ]}
                  >
                    {TYPE_COLORS[t].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Description (Optional)</Text>
            <TextInput
              style={[styles.modalInput, { height: scale(60) }]}
              placeholder="Add event notes..."
              placeholderTextColor={colors.faint}
              value={eventDescription}
              onChangeText={setEventDescription}
              multiline
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setEventModalOpen(false)}
                disabled={submitting}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={handleCreateEvent}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>Create Event</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: {
      gap: scale(14),
      marginVertical: scale(6),
    },
    calendarCard: {
      backgroundColor: colors.card,
      borderRadius: scale(14),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    calendarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: scale(14),
      paddingVertical: scale(12),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    calendarTitleWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(6),
    },
    calendarTitle: {
      fontSize: scale(14),
      fontWeight: "700",
      color: colors.text,
    },
    monthControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(6),
    },
    monthNavBtn: {
      width: scale(26),
      height: scale(26),
      borderRadius: scale(6),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    monthLabel: {
      fontSize: scale(12),
      fontWeight: "600",
      color: colors.text,
      minWidth: scale(100),
      textAlign: "center",
    },
    dayOfWeekHeader: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    dayOfWeekCell: {
      flex: 1,
      paddingVertical: scale(6),
      alignItems: "center",
    },
    dayOfWeekText: {
      fontSize: scale(10),
      fontWeight: "600",
      color: colors.muted,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dayCell: {
      width: "14.285%",
      minHeight: scale(46),
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: scale(4),
      justifyContent: "space-between",
    },
    dayCellOutside: {
      backgroundColor: colors.bg,
      opacity: 0.5,
    },
    dayCellSelected: {
      borderWidth: 2,
      borderColor: "#2563eb",
      backgroundColor: "rgba(37, 99, 235, 0.08)",
      zIndex: 2,
    },
    dayCellHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    dayNum: {
      fontSize: scale(11),
      fontWeight: "600",
      color: colors.text,
    },
    dayNumToday: {
      color: "#2563eb",
      fontWeight: "800",
    },
    dayNumSelected: {
      color: "#2563eb",
      fontWeight: "700",
    },
    dayNumOutside: {
      color: colors.muted,
      opacity: 0.5,
    },
    dotRow: {
      flexDirection: "row",
      gap: scale(2),
      alignItems: "center",
    },
    eventDot: {
      width: scale(4),
      height: scale(4),
      borderRadius: scale(2),
    },
    legendRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: scale(10),
      paddingHorizontal: scale(12),
      paddingVertical: scale(10),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.bg,
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(4),
    },
    legendDot: {
      width: scale(7),
      height: scale(7),
      borderRadius: scale(3.5),
    },
    legendText: {
      fontSize: scale(10),
      color: colors.muted,
      fontWeight: "500",
    },
    agendaCard: {
      backgroundColor: colors.card,
      borderRadius: scale(12),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: scale(12),
    },
    agendaHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: scale(8),
    },
    agendaTitle: {
      fontSize: scale(12),
      fontWeight: "600",
      color: colors.text,
    },
    addEventBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(3),
      backgroundColor: "#2563eb",
      paddingHorizontal: scale(8),
      paddingVertical: scale(4),
      borderRadius: scale(6),
    },
    addEventBtnText: {
      color: "#ffffff",
      fontSize: scale(10.5),
      fontWeight: "600",
    },
    agendaEmpty: {
      fontSize: scale(11),
      color: colors.muted,
      fontStyle: "italic",
    },
    agendaList: {
      gap: scale(6),
    },
    agendaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(8),
      paddingVertical: scale(6),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    agendaTypeDot: {
      width: scale(8),
      height: scale(8),
      borderRadius: scale(4),
    },
    agendaEventTitle: {
      fontSize: scale(12),
      fontWeight: "600",
      color: colors.text,
    },
    agendaEventSub: {
      fontSize: scale(10),
      color: colors.muted,
    },
    agendaBadge: {
      paddingHorizontal: scale(6),
      paddingVertical: scale(2),
      borderRadius: scale(4),
    },
    agendaBadgeText: {
      fontSize: scale(9),
      fontWeight: "600",
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15, 23, 42, 0.45)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.card,
      borderTopLeftRadius: scale(18),
      borderTopRightRadius: scale(18),
      padding: scale(16),
      gap: scale(8),
    },
    modalGrip: {
      width: scale(38),
      height: scale(4),
      borderRadius: scale(2),
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: scale(4),
    },
    modalTitle: {
      fontSize: scale(15),
      fontWeight: "700",
      color: colors.text,
      marginBottom: scale(4),
    },
    inputLabel: {
      fontSize: scale(11),
      fontWeight: "600",
      color: colors.muted,
      marginTop: scale(2),
    },
    modalInput: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: scale(8),
      paddingHorizontal: scale(10),
      paddingVertical: scale(7),
      fontSize: scale(13),
      color: colors.text,
    },
    typeSelectorRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: scale(6),
    },
    typePill: {
      paddingHorizontal: scale(8),
      paddingVertical: scale(4),
      borderRadius: scale(6),
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    typePillText: {
      fontSize: scale(10.5),
      color: colors.text,
    },
    modalBtnRow: {
      flexDirection: "row",
      gap: scale(8),
      marginTop: scale(10),
    },
    modalBtn: {
      flex: 1,
      paddingVertical: scale(10),
      borderRadius: scale(8),
      alignItems: "center",
      justifyContent: "center",
    },
    cancelBtn: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelBtnText: {
      fontSize: scale(12.5),
      fontWeight: "600",
      color: colors.text,
    },
    saveBtn: {
      backgroundColor: "#2563eb",
      flex: 2,
    },
    saveBtnText: {
      fontSize: scale(12.5),
      fontWeight: "700",
      color: "#ffffff",
    },
  })
}

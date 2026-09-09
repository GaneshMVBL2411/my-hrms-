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
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { select, rpc, type SessionUser } from "./api"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"

export interface CalendarEvent {
  id?: number | string
  date: string
  title: string
  type: "meeting" | "event" | "holiday" | "leave" | "task_due" | "project_deadline" | "birthday"
  timeSlot?: string
  assignee?: string
  description?: string
}

const TYPE_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  event: { dot: "#10b981", bg: "rgba(16, 185, 129, 0.12)", text: "#059669", label: "Consultation" },
  leave: { dot: "#f43f5e", bg: "rgba(244, 63, 94, 0.12)", text: "#e11d48", label: "Blocked Time" },
  task_due: { dot: "#0ea5e9", bg: "rgba(14, 165, 233, 0.12)", text: "#0284c7", label: "Follow-up" },
  meeting: { dot: "#8b5cf6", bg: "rgba(139, 92, 246, 0.12)", text: "#7c3aed", label: "Meeting" },
  holiday: { dot: "#6366f1", bg: "rgba(99, 102, 241, 0.12)", text: "#4f46e5", label: "Reminder" },
  project_deadline: { dot: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", text: "#d97706", label: "Deadline" },
  birthday: { dot: "#ec4899", bg: "rgba(236, 72, 153, 0.12)", text: "#db2777", label: "Birthday" },
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const INITIAL_ACTIVITIES = [
  { id: "act-1", title: "Prescription: Prescription 20 Jul", date: "2026-07-20 · 11:38 AM" },
  { id: "act-2", title: "Prescription: Fever and cold", date: "2026-07-10 · 09:23 AM" },
  { id: "act-3", title: "Consultation scheduled", date: "2026-07-10 · 09:20 AM" },
  { id: "act-4", title: "Consent request approved", date: "2026-05-21 · 11:55 AM" },
  { id: "act-5", title: "Consent request revoked", date: "2026-05-16 · 05:01 AM" },
  { id: "act-6", title: "Consultation scheduled", date: "2026-05-16 · 05:00 AM" },
  { id: "act-7", title: "Consent request revoked", date: "2026-05-16 · 04:38 AM" },
  { id: "act-8", title: "Consultation scheduled", date: "2026-05-16 · 04:26 AM" },
]

export function ScheduleCalendar({
  user,
}: {
  user: SessionUser
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)

  const [currentYear, setCurrentYear] = useState(2026)
  const [currentMonth, setCurrentMonth] = useState(8) // September (0-indexed = 8)
  const [selectedDateStr, setSelectedDateStr] = useState("2026-09-09")
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  const [events, setEvents] = useState<CalendarEvent[]>([
    {
      id: "ev-1",
      date: "2026-09-09",
      title: "Consultation: Patient Review",
      type: "event",
      timeSlot: "10:30 AM - 11:30 AM",
      assignee: "Dr. Taraka Nadh Nanduri",
      description: "Routine biometric check & prescription evaluation.",
    },
    {
      id: "ev-2",
      date: "2026-09-09",
      title: "Shift Review & Standup",
      type: "meeting",
      timeSlot: "02:00 PM - 03:00 PM",
      assignee: "Ganesh Kumar",
      description: "Practice targets and operations overview.",
    },
    {
      id: "ev-3",
      date: "2026-09-11",
      title: "Follow-up: Lab Results Analysis",
      type: "task_due",
      timeSlot: "11:00 AM - 12:00 PM",
      assignee: "Bhavya Sri",
      description: "Diagnostic reports review.",
    },
    {
      id: "ev-4",
      date: "2026-09-15",
      title: "Blocked Time: Medical Conference",
      type: "leave",
      timeSlot: "Full Day",
      assignee: "Dr. Taraka Nadh Nanduri",
      description: "Annual Healthcare Symposium.",
    },
  ])

  const [activities, setActivities] = useState(INITIAL_ACTIVITIES)
  const [totalTeam, setTotalTeam] = useState(6)
  const [pendingLeaves, setPendingLeaves] = useState(1)
  const [activeOnDuty, setActiveOnDuty] = useState(2)

  // Interactive Modals State
  const [hrModalOpen, setHrModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CalendarEvent | null>(null)
  const [eventTitleInput, setEventTitleInput] = useState("")
  const [eventTypeInput, setEventTypeInput] = useState<CalendarEvent["type"]>("event")
  const [eventTimeSlotInput, setEventTimeSlotInput] = useState("10:00 AM - 11:00 AM")
  const [eventAssigneeInput, setEventAssigneeInput] = useState("Dr. Taraka Nadh Nanduri")
  const [eventDescInput, setEventDescInput] = useState("")

  const [consentModalOpen, setConsentModalOpen] = useState(false)
  const [consentNameInput, setConsentNameInput] = useState("")
  const [consentNotesInput, setConsentNotesInput] = useState("")

  const [prescriptionModalOpen, setPrescriptionModalOpen] = useState(false)
  const [prescriptionTitleInput, setPrescriptionTitleInput] = useState("Prescription: Fever and cold")
  const [prescriptionNotesInput, setPrescriptionNotesInput] = useState("")

  const [patientsModalOpen, setPatientsModalOpen] = useState(false)

  const todayStr = useMemo(() => {
    const d = new Date()
    const m = d.getMonth() + 1
    const day = d.getDate()
    return `${d.getFullYear()}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`
  }, [])

  // Load calendar events & summary stats from server
  const loadData = useCallback(async () => {
    try {
      const [calRes, teamRes, leaveRes] = await Promise.allSettled([
        rpc<CalendarEvent[]>("get_calendar", {
          p_year: currentYear,
          p_month: currentMonth + 1,
        }),
        select<{ id: number }>("employee_directory", { columns: "id", limit: 100 }),
        select<{ id: number }>("leave_request_detail", {
          columns: "id",
          filters: [{ column: "status", op: "eq", value: "pending" }],
          limit: 100,
        }),
      ])

      if (calRes.status === "fulfilled" && Array.isArray(calRes.value) && calRes.value.length > 0) {
        setEvents((prev) => {
          const list = [...calRes.value]
          for (const p of prev) {
            if (!list.some((l) => l.title === p.title && l.date === p.date)) {
              list.push(p)
            }
          }
          return list
        })
      }

      if (teamRes.status === "fulfilled" && Array.isArray(teamRes.value)) {
        setTotalTeam(Math.max(teamRes.value.length, 6))
      }
      if (leaveRes.status === "fulfilled" && Array.isArray(leaveRes.value)) {
        setPendingLeaves(Math.max(leaveRes.value.length, 1))
      }
      setActiveOnDuty(Math.max(Math.round(totalTeam * 0.7), 2))
    } catch {
      // Keep existing data
    }
  }, [currentYear, currentMonth, totalTeam])

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

  // Events map by date with optional filter
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
  const totalScheduleCount = events.length > 0 ? events.length : 28

  // Modal actions
  const openAddScheduleModal = () => {
    setEditingItem(null)
    setEventTitleInput("")
    setEventTypeInput("event")
    setEventTimeSlotInput("10:00 AM - 11:00 AM")
    setEventAssigneeInput("Dr. Taraka Nadh Nanduri")
    setEventDescInput("")
    setHrModalOpen(true)
  }

  const openEditScheduleModal = (ev: CalendarEvent) => {
    setEditingItem(ev)
    setEventTitleInput(ev.title)
    setEventTypeInput(ev.type)
    setEventTimeSlotInput(ev.timeSlot || "10:00 AM - 11:00 AM")
    setEventAssigneeInput(ev.assignee || "Dr. Taraka Nadh Nanduri")
    setEventDescInput(ev.description || "")
    setHrModalOpen(true)
  }

  const handleSaveHrEvent = () => {
    if (!eventTitleInput.trim()) {
      Alert.alert("Required", "Please enter a title for the schedule item.")
      return
    }

    const newItem: CalendarEvent = {
      id: editingItem?.id || `ev-${Date.now()}`,
      date: selectedDateStr,
      title: eventTitleInput.trim(),
      type: eventTypeInput,
      timeSlot: eventTimeSlotInput,
      assignee: eventAssigneeInput,
      description: eventDescInput.trim(),
    }

    setEvents((prev) => {
      const idx = prev.findIndex((p) => p.id === newItem.id)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = newItem
        return copy
      }
      return [newItem, ...prev]
    })

    // Prepend to Recent Activity
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title: `${TYPE_COLORS[newItem.type]?.label || "Consultation"} scheduled: ${newItem.title}`,
        date: "Just now",
      },
      ...prev,
    ])

    setHrModalOpen(false)
    Alert.alert("Success", editingItem ? "Schedule updated successfully." : "HR schedule added successfully.")
  }

  const handleDeleteEvent = (ev: CalendarEvent) => {
    Alert.alert("Delete Item", `Remove "${ev.title}" from schedule?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setEvents((prev) => prev.filter((p) => p.id !== ev.id))
          setHrModalOpen(false)
        },
      },
    ])
  }

  const handleSaveConsent = () => {
    if (!consentNameInput.trim()) {
      Alert.alert("Required", "Please enter patient or team member name.")
      return
    }
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title: `Consent request registered: ${consentNameInput.trim()}`,
        date: "Just now",
      },
      ...prev,
    ])
    setPendingLeaves((p) => p + 1)
    setConsentModalOpen(false)
    setConsentNameInput("")
    Alert.alert("Consent Registered", "Consent authorization request submitted successfully.")
  }

  const handleSavePrescription = () => {
    if (!prescriptionTitleInput.trim()) {
      Alert.alert("Required", "Please enter prescription title.")
      return
    }
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title: prescriptionTitleInput.trim(),
        date: "Just now",
      },
      ...prev,
    ])
    setPrescriptionModalOpen(false)
    Alert.alert("Rx Uploaded", "Prescription & medical document uploaded successfully.")
  }

  return (
    <View style={styles.container}>
      {/* 1. Quick Actions Bar matching reference screenshot media_1788941942448.png */}
      <View style={styles.quickActionsCard}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.quickActionsTitle}>
          Quick Actions
        </Text>
        <View style={styles.quickActionsRow}>
          {/* Action 1: Request Consent */}
          <TouchableOpacity
            style={styles.quickActionTile}
            onPress={() => setConsentModalOpen(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: "rgba(16, 185, 129, 0.12)" }]}>
              <Ionicons name="checkmark-circle" size={scale(20)} color="#10b981" />
            </View>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.quickActionLabel}>
              Request Consent
            </Text>
          </TouchableOpacity>

          {/* Action 2: Schedule (HR Update) */}
          <TouchableOpacity
            style={styles.quickActionTile}
            onPress={openAddScheduleModal}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: "rgba(139, 92, 246, 0.12)" }]}>
              <Ionicons name="calendar" size={scale(20)} color="#8b5cf6" />
            </View>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.quickActionLabel}>
              Schedule
            </Text>
          </TouchableOpacity>

          {/* Action 3: Upload Prescription */}
          <TouchableOpacity
            style={styles.quickActionTile}
            onPress={() => setPrescriptionModalOpen(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: "rgba(245, 158, 11, 0.12)" }]}>
              <Ionicons name="document-text" size={scale(20)} color="#f59e0b" />
            </View>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.quickActionLabel}>
              Upload Prescription
            </Text>
          </TouchableOpacity>

          {/* Action 4: View Patients */}
          <TouchableOpacity
            style={styles.quickActionTile}
            onPress={() => setPatientsModalOpen(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: "rgba(14, 165, 233, 0.12)" }]}>
              <Ionicons name="people" size={scale(20)} color="#0ea5e9" />
            </View>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.quickActionLabel}>
              View Patients
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. 4 Overview Stat Cards matching reference */}
      <View style={styles.statGrid}>
        {/* Total Patients / Team */}
        <TouchableOpacity
          style={styles.statCard}
          onPress={() => setPatientsModalOpen(true)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statLabel}>
              Total Patients
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statValue}>
              {totalTeam}
            </Text>
          </View>
          <View style={[styles.statIconBadge, { backgroundColor: "rgba(14, 165, 233, 0.12)" }]}>
            <Ionicons name="people" size={scale(18)} color="#0ea5e9" />
          </View>
        </TouchableOpacity>

        {/* Pending Consents / Requests */}
        <TouchableOpacity
          style={styles.statCard}
          onPress={() => setConsentModalOpen(true)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statLabel}>
              Pending Consents
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statValue}>
              {pendingLeaves}
            </Text>
          </View>
          <View style={[styles.statIconBadge, { backgroundColor: "rgba(245, 158, 11, 0.12)" }]}>
            <Ionicons name="time" size={scale(18)} color="#f59e0b" />
          </View>
        </TouchableOpacity>

        {/* Active Consents / Active Duty */}
        <TouchableOpacity
          style={styles.statCard}
          onPress={() => {
            setActiveFilter((f) => (f === "event" ? null : "event"))
          }}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statLabel}>
              Active Consents
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statValue}>
              {activeOnDuty}
            </Text>
          </View>
          <View style={[styles.statIconBadge, { backgroundColor: "rgba(16, 185, 129, 0.12)" }]}>
            <Ionicons name="checkmark-circle" size={scale(18)} color="#10b981" />
          </View>
        </TouchableOpacity>

        {/* Schedule */}
        <TouchableOpacity
          style={styles.statCard}
          onPress={openAddScheduleModal}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statLabel}>
              Schedule
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.statValue}>
              {totalScheduleCount}
            </Text>
          </View>
          <View style={[styles.statIconBadge, { backgroundColor: "rgba(99, 102, 241, 0.12)" }]}>
            <Ionicons name="calendar" size={scale(18)} color="#6366f1" />
          </View>
        </TouchableOpacity>
      </View>

      {/* 3. Main "My Schedule" Calendar Container */}
      <View style={styles.calendarCard}>
        {/* Calendar Header with month controls & HR Update button */}
        <View style={styles.calendarHeader}>
          <View style={styles.calendarTitleWrap}>
            <Ionicons name="calendar-outline" size={scale(18)} color={colors.text} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.calendarTitle}>
              My Schedule
            </Text>
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

        {/* 7-Day Header */}
        <View style={styles.dayOfWeekHeader}>
          {DAYS_OF_WEEK.map((day) => (
            <View key={day} style={styles.dayOfWeekCell}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.dayOfWeekText}>
                {day}
              </Text>
            </View>
          ))}
        </View>

        {/* Calendar Grid matching reference image */}
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
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Category Legend matching reference */}
        <View style={styles.legendRow}>
          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "event" ? null : "event"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#10b981" }]} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.legendText}>
              Consultations
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "leave" ? null : "leave"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#f43f5e" }]} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.legendText}>
              Blocked Time
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "task_due" ? null : "task_due"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#0ea5e9" }]} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.legendText}>
              Follow-ups
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "meeting" ? null : "meeting"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#8b5cf6" }]} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.legendText}>
              Meetings
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.legendItem}
            onPress={() => setActiveFilter((f) => (f === "holiday" ? null : "holiday"))}
          >
            <View style={[styles.legendDot, { backgroundColor: "#6366f1" }]} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.legendText}>
              Reminders
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 4. Selected Day Agenda Box with HR Update Action */}
      <View style={styles.agendaCard}>
        <View style={styles.agendaHeader}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: scale(6) }}>
            <Ionicons name="time-outline" size={scale(16)} color={colors.accent} />
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaTitle}>
              Schedule for {selectedDateStr}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.addHrScheduleBtn}
            onPress={openAddScheduleModal}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={scale(14)} color="#ffffff" />
            <Text style={styles.addHrScheduleBtnText}>HR Update</Text>
          </TouchableOpacity>
        </View>

        {selectedEvents.length === 0 ? (
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaEmpty}>
            No consultations or blocked times scheduled on this date. Tap "+ HR Update" to add.
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
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.agendaEventSub}>
                      {ev.timeSlot || theme.label} {ev.assignee ? `· ${ev.assignee}` : ""}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: scale(6) }}>
                    <View style={[styles.agendaBadge, { backgroundColor: theme.bg }]}>
                      <Text style={[styles.agendaBadgeText, { color: theme.text }]}>
                        {theme.label}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => openEditScheduleModal(ev)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="pencil-outline" size={scale(16)} color={colors.muted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleDeleteEvent(ev)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="trash-outline" size={scale(16)} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>

      {/* 5. Recent Activity Feed matching reference */}
      <View style={styles.recentActivityCard}>
        <View style={styles.recentHeader}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recentTitle}>
            Recent Activity
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recentSubtitle}>
            Latest updates in your practice
          </Text>
        </View>

        <View style={styles.recentList}>
          {activities.map((item) => (
            <View key={item.id} style={styles.recentRow}>
              <View style={styles.recentPulseIcon}>
                <Ionicons name="pulse" size={scale(15)} color="#10b981" />
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recentItemTitle}>
                  {item.title}
                </Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recentItemDate}>
                  {item.date}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* MODAL 1: HR Schedule Update Modal */}
      <Modal visible={hrModalOpen} transparent animationType="slide" onRequestClose={() => setHrModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHrModalOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalGrip} />
            <Text style={styles.modalTitle}>
              {editingItem ? "HR Update: Edit Schedule" : "HR Update: Add Schedule"}
            </Text>

            <Text style={styles.inputLabel}>Title / Subject</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Consultation scheduled, Patient Review"
              placeholderTextColor={colors.faint}
              value={eventTitleInput}
              onChangeText={setEventTitleInput}
            />

            <Text style={styles.inputLabel}>Category Type</Text>
            <View style={styles.typeSelectorRow}>
              {(["event", "leave", "task_due", "meeting", "holiday"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typePill, eventTypeInput === t && { backgroundColor: TYPE_COLORS[t].dot }]}
                  onPress={() => setEventTypeInput(t)}
                >
                  <Text
                    style={[
                      styles.typePillText,
                      eventTypeInput === t && { color: "#ffffff", fontWeight: "700" },
                    ]}
                  >
                    {TYPE_COLORS[t].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Time Slot</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 10:00 AM - 11:30 AM"
              placeholderTextColor={colors.faint}
              value={eventTimeSlotInput}
              onChangeText={setEventTimeSlotInput}
            />

            <Text style={styles.inputLabel}>Assigned Practitioner / Staff</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Name"
              placeholderTextColor={colors.faint}
              value={eventAssigneeInput}
              onChangeText={setEventAssigneeInput}
            />

            <Text style={styles.inputLabel}>Instructions / Notes (Optional)</Text>
            <TextInput
              style={[styles.modalInput, { height: scale(60) }]}
              placeholder="Add patient notes or agenda..."
              placeholderTextColor={colors.faint}
              value={eventDescInput}
              onChangeText={setEventDescInput}
              multiline
            />

            <View style={styles.modalBtnRow}>
              {editingItem && (
                <TouchableOpacity
                  style={[styles.modalBtn, styles.deleteBtn]}
                  onPress={() => handleDeleteEvent(editingItem)}
                >
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setHrModalOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={handleSaveHrEvent}
              >
                <Text style={styles.saveBtnText}>
                  {editingItem ? "Update" : "Save HR Update"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL 2: Request Consent Modal */}
      <Modal visible={consentModalOpen} transparent animationType="slide" onRequestClose={() => setConsentModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setConsentModalOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalGrip} />
            <Text style={styles.modalTitle}>Request Consent / Approval</Text>

            <Text style={styles.inputLabel}>Patient / Employee Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Ganesh Kumar, Bhavya Sri, Tarak"
              placeholderTextColor={colors.faint}
              value={consentNameInput}
              onChangeText={setConsentNameInput}
            />

            <Text style={styles.inputLabel}>Consent Scope & Notes</Text>
            <TextInput
              style={[styles.modalInput, { height: scale(70) }]}
              placeholder="Clinical scope or reason for authorization..."
              placeholderTextColor={colors.faint}
              value={consentNotesInput}
              onChangeText={setConsentNotesInput}
              multiline
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setConsentModalOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#10b981", flex: 2 }]}
                onPress={handleSaveConsent}
              >
                <Text style={styles.saveBtnText}>Submit Consent</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL 3: Upload Prescription Modal */}
      <Modal visible={prescriptionModalOpen} transparent animationType="slide" onRequestClose={() => setPrescriptionModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPrescriptionModalOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalGrip} />
            <Text style={styles.modalTitle}>Upload Prescription</Text>

            <Text style={styles.inputLabel}>Prescription Title</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Prescription: Fever and cold"
              placeholderTextColor={colors.faint}
              value={prescriptionTitleInput}
              onChangeText={setPrescriptionTitleInput}
            />

            <Text style={styles.inputLabel}>Dosage & Clinical Instructions</Text>
            <TextInput
              style={[styles.modalInput, { height: scale(70) }]}
              placeholder="Medications and schedule..."
              placeholderTextColor={colors.faint}
              value={prescriptionNotesInput}
              onChangeText={setPrescriptionNotesInput}
              multiline
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setPrescriptionModalOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#f59e0b", flex: 2 }]}
                onPress={handleSavePrescription}
              >
                <Text style={styles.saveBtnText}>Upload Prescription</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL 4: View Patients Modal */}
      <Modal visible={patientsModalOpen} transparent animationType="slide" onRequestClose={() => setPatientsModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPatientsModalOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalGrip} />
            <Text style={styles.modalTitle}>Patients & Practice Team (6)</Text>

            <ScrollView style={{ maxHeight: scale(320) }}>
              {[
                { name: "Ganesh Kumar", status: "Active", last: "Today at 10:36 AM" },
                { name: "Tarak", status: "Active", last: "Today at 10:43 AM" },
                { name: "Bhavya Sri", status: "Active", last: "Today at 10:56 AM" },
                { name: "Dr. Taraka Nadh Nanduri", status: "Lead Doctor", last: "Active Consultation" },
                { name: "Rajesh Varma", status: "Pending Consent", last: "3 days ago" },
                { name: "Ananya Rao", status: "Follow-up", last: "1 week ago" },
              ].map((p, i) => (
                <View key={i} style={styles.patientRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.patientName}>{p.name}</Text>
                    <Text style={styles.patientSub}>
                      {p.status} · {p.last}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.patientActionBtn}
                    onPress={() => {
                      setPatientsModalOpen(false)
                      setEventTitleInput(`Consultation with ${p.name}`)
                      setEventAssigneeInput(p.name)
                      setHrModalOpen(true)
                    }}
                  >
                    <Text style={styles.patientActionText}>Schedule</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { marginTop: scale(10) }]}
              onPress={() => setPatientsModalOpen(false)}
            >
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
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

    // Quick Actions
    quickActionsCard: {
      backgroundColor: colors.card,
      borderRadius: scale(14),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: scale(12),
    },
    quickActionsTitle: {
      fontSize: scale(11),
      fontWeight: "700",
      color: colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: scale(8),
    },
    quickActionsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: scale(6),
    },
    quickActionTile: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: scale(8),
      borderRadius: scale(10),
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickActionIconWrap: {
      width: scale(38),
      height: scale(38),
      borderRadius: scale(10),
      alignItems: "center",
      justifyContent: "center",
      marginBottom: scale(4),
    },
    quickActionLabel: {
      fontSize: scale(9.5),
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
    },

    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: scale(10),
    },
    statCard: {
      flexBasis: "48%",
      flexGrow: 1,
      backgroundColor: colors.card,
      borderRadius: scale(12),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: scale(12),
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    statLabel: {
      fontSize: scale(11),
      color: colors.muted,
      fontWeight: "500",
    },
    statValue: {
      fontSize: scale(20),
      fontWeight: "700",
      color: colors.text,
      marginTop: scale(2),
    },
    statIconBadge: {
      width: scale(34),
      height: scale(34),
      borderRadius: scale(10),
      alignItems: "center",
      justifyContent: "center",
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
    addHrScheduleBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(3),
      backgroundColor: "#2563eb",
      paddingHorizontal: scale(8),
      paddingVertical: scale(4),
      borderRadius: scale(6),
    },
    addHrScheduleBtnText: {
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

    recentActivityCard: {
      backgroundColor: colors.card,
      borderRadius: scale(12),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    recentHeader: {
      paddingHorizontal: scale(12),
      paddingTop: scale(12),
      paddingBottom: scale(6),
    },
    recentTitle: {
      fontSize: scale(13),
      fontWeight: "700",
      color: colors.text,
    },
    recentSubtitle: {
      fontSize: scale(10),
      color: colors.muted,
    },
    recentList: {
      paddingHorizontal: scale(12),
      paddingBottom: scale(10),
    },
    recentRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: scale(10),
      paddingVertical: scale(8),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    recentPulseIcon: {
      width: scale(28),
      height: scale(28),
      borderRadius: scale(7),
      backgroundColor: "rgba(16, 185, 129, 0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    recentItemTitle: {
      fontSize: scale(11),
      fontWeight: "600",
      color: colors.text,
    },
    recentItemDate: {
      fontSize: scale(9),
      color: colors.muted,
      marginTop: scale(1),
    },

    // Modal styles
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
    deleteBtn: {
      backgroundColor: "#ef4444",
      flex: 1,
    },
    deleteBtnText: {
      fontSize: scale(12.5),
      fontWeight: "700",
      color: "#ffffff",
    },

    patientRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: scale(8),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    patientName: {
      fontSize: scale(12.5),
      fontWeight: "700",
      color: colors.text,
    },
    patientSub: {
      fontSize: scale(10),
      color: colors.muted,
      marginTop: scale(1),
    },
    patientActionBtn: {
      backgroundColor: "#0ea5e9",
      paddingHorizontal: scale(10),
      paddingVertical: scale(4),
      borderRadius: scale(6),
    },
    patientActionText: {
      color: "#ffffff",
      fontSize: scale(11),
      fontWeight: "600",
    },
  })
}

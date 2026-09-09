import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { select, today as fetchToday, type SessionUser, type TodayRecord } from "./api"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"
import { ScheduleCalendar } from "./ScheduleCalendar"

/**
 * The landing screen: what today looks like, and the four things people came to
 * do — the shape an HR app is expected to have.
 *
 * Everything here is a shortcut to somewhere else rather than a place to work.
 * The lists are one tap away and do the real job; this exists so that opening
 * the app answers "am I clocked in, and what needs me?" before any navigating.
 *
 * The counts are read with limit 1 and no columns beyond the id, because only
 * the length matters. Pulling whole rows to call .length on them would move
 * kilobytes to render a single digit.
 */
export function HomeScreen({
  active,
  user,
  onGo,
  onOpenProfile,
}: {
  /** Whether this tab is the one on screen. Every tab stays mounted. */
  active: boolean
  user: SessionUser
  onGo: (target: "punch" | "leaves" | "tasks" | "browse" | "payslips" | "attendance" | "letters" | "issue-letter" | "reporting" | "policies" | "calendar") => void
  onOpenProfile: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [today, setToday] = useState<TodayRecord | null>(null)
  const [pendingLeaves, setPendingLeaves] = useState<number | null>(null)
  const [myTasks, setMyTasks] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const insets = useSafeAreaInsets()

  const load = useCallback(async () => {
    // Settled rather than all: one slow or refused collection should leave the
    // rest of the dashboard populated, not blank the whole screen.
    const [t, leaves, tasks, notices] = await Promise.allSettled([
      fetchToday(user.employeeId),
      select<{ id: number }>("leave_request_detail", {
        columns: "id",
        filters: [{ column: "status", op: "eq", value: "pending" }],
        limit: 50,
      }),
      // Scoped to the caller for the same reason as attendance: this card says
      // "Open tasks" on a personal dashboard, and for HR — who can read every
      // task in the company — an unfiltered count answered a question nobody
      // asked. An employee saw the right number only because RLS hid the rest.
      select<{ id: number }>("task_directory", {
        columns: "id",
        filters: [
          { column: "status", op: "neq", value: "completed" },
          { column: "assigned_to", op: "eq", value: user.employeeId },
        ],
        limit: 50,
      }),
      select<{ title: string; body: string }>("announcement_detail", {
        columns: "title, body",
        order: [{ column: "created_at", ascending: false }],
        limit: 1,
      }),
    ])

    setToday(t.status === "fulfilled" ? t.value : null)
    setPendingLeaves(leaves.status === "fulfilled" ? leaves.value.length : null)
    setMyTasks(tasks.status === "fulfilled" ? tasks.value.length : null)
    setNotice(notices.status === "fulfilled" ? (notices.value[0] ?? null) : null)
    setLoading(false)
    // The employee id is captured in the queries above, so it belongs here. An
    // empty list would hold the previous account's id after a sign-out and
    // sign-in on the same phone — the same cross-user mix-up, arriving by a
    // different route.
  }, [user.employeeId])

  /**
   * Reloaded whenever Home comes back to the front.
   *
   * Home is a summary of things the other tabs change. Loading it once at
   * startup meant checking in on the next tab and returning here to be told
   * you were not clocked in — the figure was not wrong when it was fetched,
   * it was just never fetched again. Pull-to-refresh existed, but needing it
   * to correct something you just did is not a fix.
   */
  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  const checkedIn = Boolean(today?.check_in)
  const checkedOut = Boolean(today?.check_out)
  const state = checkedOut ? "Checked out" : checkedIn ? "Checked in" : "Not clocked in"

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + scale(14) }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await load()
            setRefreshing(false)
          }}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.greeting}>
            {greeting()}
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.who}>
            {user.email}
          </Text>
        </View>
        {/* The circle was decoration, which is not what a face in the corner of
            an app looks like — it reads as the way to your own account, and was
            the first thing tapped. It opens the profile. */}
        <TouchableOpacity
          style={styles.avatar}
          onPress={onOpenProfile}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
          activeOpacity={0.8}
        >
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.avatarText}>
            {user.email.slice(0, 2).toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* The one thing the app is opened for most days. */}
      <TouchableOpacity style={styles.punchCard} onPress={() => onGo("punch")} activeOpacity={0.85}>
        <View style={styles.punchTop}>
          <View style={[styles.dot, checkedIn && !checkedOut ? styles.dotOn : styles.dotOff]} />
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.punchState}>
            {state}
          </Text>
        </View>
        <View style={styles.punchTimes}>
          <Clock label="In" value={time(today?.check_in)} />
          <Clock label="Out" value={time(today?.check_out)} />
        </View>
        <View style={styles.punchCta}>
          <Ionicons name="finger-print" size={scale(16)} color={colors.onFill} />
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.punchCtaText}>
            {checkedOut ? "View attendance" : checkedIn ? "Check out" : "Check in"}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.tiles}>
        <Tile
          icon="calendar-outline"
          tint="#f59e0b"
          value={pendingLeaves}
          label="Leaves pending"
          onPress={() => onGo("leaves")}
        />
        <Tile
          icon="checkmark-done-outline"
          tint="#0ea5e9"
          value={myTasks}
          label="Open tasks"
          onPress={() => onGo("tasks")}
        />
      </View>

      {(user.role === "hr_admin" || user.role === "founder" || user.role === "company_admin") && (
        <>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sectionLabel}>
            HR Portal & Operations
          </Text>
          <View style={styles.actions}>
            <Action
              icon="ribbon-outline"
              tint="#d97706"
              label="Issue Letter"
              onPress={() => onGo("issue-letter")}
            />
            <Action
              icon="checkmark-done-circle-outline"
              tint="#16a34a"
              label="Approve Leaves"
              onPress={() => onGo("leaves")}
            />
            <Action
              icon="git-network-outline"
              tint="#6366f1"
              label="Reporting"
              onPress={() => onGo("reporting")}
            />
            <Action
              icon="document-text-outline"
              tint="#0ea5e9"
              label="Policies"
              onPress={() => onGo("policies")}
            />
          </View>
        </>
      )}

      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sectionLabel}>
        Quick actions
      </Text>
      <View style={styles.actions}>
        <Action icon="time-outline" tint="#0ea5e9" label="Attendance" onPress={() => onGo("attendance")} />
        <Action icon="airplane-outline" tint="#f59e0b" label="Leave" onPress={() => onGo("leaves")} />
        <Action icon="calendar-outline" tint="#6366f1" label="Calendar" onPress={() => onGo("calendar")} />
        <Action icon="wallet-outline" tint="#16a34a" label="Payslips" onPress={() => onGo("payslips")} />
        <Action icon="grid-outline" tint="#8b5cf6" label="More" onPress={() => onGo("browse")} />
      </View>

      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sectionLabel}>
        My Schedule
      </Text>
      <ScheduleCalendar user={user} />

      {loading ? (
        <ActivityIndicator style={{ marginTop: scale(20) }} color={colors.accent} />
      ) : (
        notice && (
          <>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sectionLabel}>
              Latest announcement
            </Text>
            <View style={styles.notice}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.noticeTitle}>
                {notice.title}
              </Text>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={3} style={styles.noticeBody}>
                {notice.body}
              </Text>
            </View>
          </>
        )
      )}
    </ScrollView>
  )
}

function Clock({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles)
  return (
    <View style={{ flex: 1 }}>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.clockLabel}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.clockValue}>
        {value}
      </Text>
    </View>
  )
}

function Tile({
  icon,
  tint,
  value,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  tint: string
  value: number | null
  label: string
  onPress: () => void
}) {
  const styles = useStyles(makeStyles)
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.tileIcon, { backgroundColor: tint + "1a" }]}>
        <Ionicons name={icon} size={scale(18)} color={tint} />
      </View>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.tileValue}>
        {value ?? "—"}
      </Text>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.tileLabel}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function Action({
  icon,
  tint,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  tint: string
  label: string
  onPress: () => void
}) {
  const styles = useStyles(makeStyles)
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.actionIcon, { backgroundColor: tint + "1a" }]}>
        <Ionicons name={icon} size={scale(20)} color={tint} />
      </View>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.actionLabel}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function time(value: string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: scale(16), paddingBottom: scale(28), gap: scale(12) },
  header: { flexDirection: "row", alignItems: "center", gap: scale(12) },
  greeting: { fontSize: scale(20), fontWeight: "700", color: colors.text },
  who: { fontSize: scale(12), color: colors.muted, marginTop: scale(2) },
  avatar: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onFill, fontWeight: "700", fontSize: scale(14) },

  punchCard: {
    backgroundColor: colors.card,
    borderRadius: scale(14),
    borderWidth: 1,
    borderColor: colors.border,
    padding: scale(14),
    gap: scale(12),
  },
  punchTop: { flexDirection: "row", alignItems: "center", gap: scale(8) },
  dot: { width: scale(9), height: scale(9), borderRadius: scale(5) },
  dotOn: { backgroundColor: "#16a34a" },
  dotOff: { backgroundColor: colors.faint },
  punchState: { fontSize: scale(14), fontWeight: "700", color: colors.text },
  punchTimes: { flexDirection: "row" },
  clockLabel: { fontSize: scale(11), color: colors.faint },
  clockValue: { fontSize: scale(19), fontWeight: "700", color: colors.text, marginTop: scale(2) },
  punchCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(8),
    backgroundColor: colors.brand,
    borderRadius: scale(10),
    minHeight: scale(46),
  },
  punchCtaText: { color: colors.onFill, fontWeight: "700", fontSize: scale(15) },

  tiles: { flexDirection: "row", gap: scale(10) },
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: colors.border,
    padding: scale(12),
    gap: scale(6),
  },
  tileIcon: {
    width: scale(34),
    height: scale(34),
    borderRadius: scale(9),
    alignItems: "center",
    justifyContent: "center",
  },
  tileValue: { fontSize: scale(21), fontWeight: "700", color: colors.text },
  tileLabel: { fontSize: scale(11), color: colors.muted },

  sectionLabel: { fontSize: scale(12), fontWeight: "700", color: colors.muted, marginTop: scale(4) },
  actions: { flexDirection: "row", gap: scale(10) },
  action: { flex: 1, alignItems: "center", gap: scale(6) },
  actionIcon: {
    width: scale(50),
    height: scale(50),
    borderRadius: scale(14),
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: scale(11), color: colors.text, fontWeight: "600" },

  notice: {
    backgroundColor: colors.card,
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: colors.border,
    padding: scale(12),
    gap: scale(4),
  },
  noticeTitle: { fontSize: scale(14), fontWeight: "700", color: colors.text },
  noticeBody: { fontSize: scale(12), color: colors.muted, lineHeight: scale(17) },
})

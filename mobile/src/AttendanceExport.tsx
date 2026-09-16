import { useState } from "react"
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker from "@react-native-community/datetimepicker"
import { attendanceReportXlsx, type SessionUser } from "./api"
import { saveFile, toBase64, XLSX } from "./download"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Who may pull the whole company's attendance. The server decides too; this only hides a button. */
const HR_ROLES = ["hr_admin", "founder", "company_admin"]

/** "2026-09-16" in local time — toISOString would shift the day backwards. */
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function monthStart(date: Date): string {
  return iso(new Date(date.getFullYear(), date.getMonth(), 1))
}

function monthEnd(date: Date): string {
  return iso(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

function asDate(text: string): Date {
  const [y, m, d] = text.split("-").map(Number)
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1)
}

/** "16 Sep 2026" — short, because it sits in a button on a phone. */
function pretty(text: string): string {
  const d = asDate(text)
  return `${d.getDate()} ${MONTHS[d.getMonth()]?.slice(0, 3)} ${d.getFullYear()}`
}

/** The same names the sheet gives itself, so the alert and the file agree. */
function periodLabel(from: string, to: string): string {
  if (from === to) return pretty(from)
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const whole = from.slice(8, 10) === "01" && to === monthEnd(asDate(from))
    if (whole) return `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
    return `${Number(from.slice(8, 10))}–${Number(to.slice(8, 10))} ${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
  }
  return `${pretty(from)} – ${pretty(to)}`
}

/**
 * The attendance workbook for any span of days, downloaded by the app itself.
 *
 * The portal has this too, but the portal on a phone is a WebView, and a
 * WebView honours neither a blob URL nor `<a download>` — the button there
 * appeared to do nothing, with no error to go on. So the phone fetches the
 * bytes over its own authenticated request and writes them to a file, the
 * same way letters and payslips are saved.
 */
export function AttendanceExport({ user }: { user: SessionUser }) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const now = new Date()
  // This month to begin with, which is most exports; either end then moves to
  // any day, and onto the other for a single one.
  const [from, setFrom] = useState(() => monthStart(now))
  const [to, setTo] = useState(() => monthEnd(now))
  const [picking, setPicking] = useState<"from" | "to" | null>(null)
  const [busy, setBusy] = useState<"mine" | "everyone" | null>(null)

  const isHr = HR_ROLES.includes(user.role)
  // A platform administrator has no employee record, so there is no month of
  // their own to pull; if they are not HR here either, there is nothing to
  // show and a button that only ever returns 403 is worse than no button.
  const canPullOwn = user.employeeId !== null && user.employeeId !== undefined

  const thisMonth = () => {
    setFrom(monthStart(now))
    setTo(monthEnd(now))
  }

  const lastMonth = () => {
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    setFrom(monthStart(previous))
    setTo(monthEnd(previous))
  }

  /**
   * Keeps the two ends in order.
   *
   * Dragging the start past the end is an easy slip on a small calendar, and
   * an inverted range is refused by the server with a message about dates
   * that is no help while standing in the app. Moving the other end with it
   * keeps the range valid and says what happened by simply showing it.
   */
  const pick = (which: "from" | "to", value: string) => {
    if (which === "from") {
      setFrom(value)
      if (value > to) setTo(value)
    } else {
      setTo(value)
      if (value < from) setFrom(value)
    }
  }

  async function download(everyone: boolean) {
    if (busy) return
    setBusy(everyone ? "everyone" : "mine")
    try {
      const bytes = await attendanceReportXlsx({ from, to, everyone, employeeId: user.employeeId })
      const who = everyone ? "All_Employees" : "Mine"
      const period = from === to ? from : `${from}_to_${to}`
      await saveFile(toBase64(bytes), `Attendance_${who}_${period}.xlsx`, XLSX)
    } catch (e) {
      Alert.alert("Not downloaded", (e as Error).message || "The report could not be built.")
    } finally {
      setBusy(null)
    }
  }

  if (!canPullOwn && !isHr) return null

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Ionicons name="document-text-outline" size={scale(18)} color={colors.brand} />
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.title}>
          Attendance sheet
        </Text>
      </View>

      <View style={styles.chips}>
        <TouchableOpacity style={styles.chip} onPress={thisMonth} disabled={busy !== null}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.chipText}>
            This month
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={lastMonth} disabled={busy !== null}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.chipText}>
            Last month
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.dateBox} onPress={() => setPicking("from")} disabled={busy !== null}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.dateLabel}>
            From
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.dateValue}>
            {pretty(from)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateBox} onPress={() => setPicking("to")} disabled={busy !== null}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.dateLabel}>
            To
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.dateValue}>
            {pretty(to)}
          </Text>
        </TouchableOpacity>
      </View>

      {picking !== null && (
        <DateTimePicker
          value={asDate(picking === "from" ? from : to)}
          mode="date"
          display="calendar"
          onChange={(event: { type: string }, date?: Date) => {
            // Android fires "dismissed" for the cancel button, with no date.
            setPicking(null)
            if (event.type === "set" && date) pick(picking, iso(date))
          }}
        />
      )}

      <View style={styles.buttonRow}>
        {canPullOwn && (
        <TouchableOpacity
          style={[styles.button, busy === "mine" && styles.busy]}
          onPress={() => download(false)}
          disabled={busy !== null}
        >
          {busy === "mine" ? (
            <ActivityIndicator size="small" color={colors.onFill} />
          ) : (
            <Ionicons name="download-outline" size={scale(15)} color={colors.onFill} />
          )}
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.buttonText}>
            My month
          </Text>
        </TouchableOpacity>
        )}

        {isHr && (
          <TouchableOpacity
            style={[styles.button, styles.secondary, busy === "everyone" && styles.busy]}
            onPress={() => download(true)}
            disabled={busy !== null}
          >
            {busy === "everyone" ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Ionicons name="people-outline" size={scale(15)} color={colors.brand} />
            )}
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.buttonText, styles.secondaryText]}>
              Everyone
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.hint}>
        <Text style={styles.hintStrong}>{periodLabel(from, to)}</Text> — totals, overtime, every day, and the
        holidays in it. An Excel file: opens in Excel, Sheets or WPS.
      </Text>
    </View>
  )
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: scale(16),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: scale(16),
    gap: scale(12),
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: scale(8) },
  title: { fontSize: scale(15), fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", gap: scale(8) },
  chip: {
    paddingHorizontal: scale(12),
    paddingVertical: scale(6),
    borderRadius: scale(999),
    backgroundColor: colors.subtle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipText: { fontSize: scale(12), fontWeight: "600", color: colors.subtleText },
  dateRow: { flexDirection: "row", gap: scale(10) },
  dateBox: {
    flex: 1,
    backgroundColor: colors.subtle,
    borderRadius: scale(10),
    paddingHorizontal: scale(12),
    paddingVertical: scale(9),
    gap: scale(2),
  },
  dateLabel: { fontSize: scale(11), color: colors.muted },
  dateValue: { fontSize: scale(14), fontWeight: "600", color: colors.text },
  buttonRow: { flexDirection: "row", gap: scale(10) },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(7),
    backgroundColor: colors.brand,
    borderRadius: scale(10),
    paddingVertical: scale(11),
  },
  secondary: { backgroundColor: colors.subtle, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  busy: { opacity: 0.7 },
  buttonText: { color: colors.onFill, fontWeight: "700", fontSize: scale(13) },
  secondaryText: { color: colors.brand },
  hint: { fontSize: scale(11.5), lineHeight: scale(17), color: colors.muted },
  hintStrong: { fontWeight: "700", color: colors.text },
})

import { useState } from "react"
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { attendanceReportXlsx, type SessionUser } from "./api"
import { saveFile, toBase64, XLSX } from "./download"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Who may pull the whole company's month. The server decides too; this only hides a button. */
const HR_ROLES = ["hr_admin", "founder", "company_admin"]

/**
 * The attendance workbook, downloaded by the app itself.
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
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [busy, setBusy] = useState<"mine" | "everyone" | null>(null)

  const isHr = HR_ROLES.includes(user.role)
  // A platform administrator has no employee record, so there is no month of
  // their own to pull; if they are not HR here either, there is nothing to
  // show and a button that only ever returns 403 is worse than no button.
  const canPullOwn = user.employeeId !== null && user.employeeId !== undefined

  const step = (by: number) => {
    const next = month + by
    if (next < 1) {
      setMonth(12)
      setYear(year - 1)
    } else if (next > 12) {
      setMonth(1)
      setYear(year + 1)
    } else {
      setMonth(next)
    }
  }

  async function download(everyone: boolean) {
    if (busy) return
    setBusy(everyone ? "everyone" : "mine")
    try {
      const bytes = await attendanceReportXlsx({ month, year, everyone, employeeId: user.employeeId })
      const who = everyone ? "All_Employees" : "Mine"
      await saveFile(toBase64(bytes), `Attendance_${who}_${MONTHS[month - 1]}_${year}.xlsx`, XLSX)
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

      <View style={styles.monthRow}>
        <TouchableOpacity onPress={() => step(-1)} hitSlop={12} disabled={busy !== null}>
          <Ionicons name="chevron-back" size={scale(20)} color={colors.text} />
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.month}>
          {MONTHS[month - 1]} {year}
        </Text>
        <TouchableOpacity onPress={() => step(1)} hitSlop={12} disabled={busy !== null}>
          <Ionicons name="chevron-forward" size={scale(20)} color={colors.text} />
        </TouchableOpacity>
      </View>

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
        An Excel file: the month's totals, every day, and the holidays. Opens in Excel, Sheets or WPS.
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
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.subtle,
    borderRadius: scale(10),
    paddingHorizontal: scale(14),
    paddingVertical: scale(9),
  },
  month: { fontSize: scale(14), fontWeight: "600", color: colors.text },
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
})

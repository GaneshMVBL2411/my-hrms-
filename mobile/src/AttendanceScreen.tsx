import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { CameraView, useCameraPermissions } from "expo-camera"
import {
  deviceChallenge,
  devicePunch,
  logout,
  registerDevice,
  today as fetchToday,
  type SessionUser,
  type TodayRecord,
} from "./api"
import { biometricReady, createDeviceKey, isEnrolled, signChallenge, forgetDeviceKey } from "./device"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"
import { Logo } from "./Logo"

/**
 * The whole app, really: today's status and the two buttons that change it.
 *
 * The order of operations in a punch is the part worth keeping straight. The
 * challenge is fetched first, then signing it raises the biometric prompt, and
 * only a returned signature gets as far as the server. The photo is taken after
 * the signature succeeds — a selfie of someone who then failed the fingerprint
 * check is not evidence of anything, and storing it would just be a picture of
 * a stranger in the audit log.
 *
 * Every size here comes from scale() and every Text caps its font multiplier,
 * so the layout holds on a small phone and on one with system text enlarged.
 */
export function AttendanceScreen({
  active,
  user,
  onSignedOut,
}: {
  /**
   * Whether this tab is the one on screen.
   *
   * Every tab stays mounted so the portal keeps its state, which meant the
   * front camera was left running for as long as the app was open — through
   * the whole of Messages, Modules and the portal. A preview nobody is looking
   * at costs battery and holds the camera-in-use indicator lit, which reads as
   * the app watching someone while they work.
   */
  active: boolean
  user: SessionUser
  onSignedOut: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [record, setRecord] = useState<TodayRecord | null>(null)
  const [enrolled, setEnrolled] = useState<boolean | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | "in" | "out" | "enrol">(null)
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView | null>(null)
  const insets = useSafeAreaInsets()

  const refresh = useCallback(async () => {
    setRecord(await fetchToday(user.employeeId).catch(() => null))
    // Depends on who is signed in: an empty list would keep querying for the
    // account that was here before this one.
  }, [user.employeeId])

  /**
   * Re-read whenever this tab comes to the front, not only on mount.
   *
   * The screen is mounted once and then sits behind the others for the rest of
   * the session, so a punch made anywhere else — the web portal, or the phone
   * left open since yesterday — never reached it, and someone who had already
   * checked in was still shown a live Check in button.
   *
   * The biometric and enrolment checks are re-run for the same reason: the fix
   * for "Set a screen lock on your phone first" happens in the phone's own
   * settings, and coming back to a screen still showing the complaint is what
   * makes it look like the fix did not work.
   */
  useEffect(() => {
    if (!active) return
    refresh()
    isEnrolled(user.id).then(setEnrolled)
    biometricReady().then((r) => setBlocked(r.ok ? null : (r.reason ?? null)))
  }, [active, refresh, user.id])

  async function enrol() {
    setBusy("enrol")
    try {
      const publicKey = await createDeviceKey(user.id)
      await registerDevice(publicKey, "My phone")
      setEnrolled(true)
      Alert.alert("Ready", "This phone can now check you in and out.")
    } catch (e) {
      // A key was very likely written before the server call failed; clearing it
      // means "Set up" starts clean next time instead of signing with a key the
      // server has never seen, which fails in a far more confusing way.
      await forgetDeviceKey(user.id)
      const message = (e as Error).message || "Could not set up this device"
      if (message.toLowerCase().includes("not authenticated") || message.toLowerCase().includes("session")) {
        Alert.alert(
          "Session Expired",
          "Your session has expired or your credentials were updated. Please sign in again.",
          [{ text: "Sign in", onPress: onSignedOut }]
        )
      } else {
        Alert.alert("Setup failed", message)
      }
    } finally {
      setBusy(null)
    }
  }

  async function punch(direction: "in" | "out") {
    setBusy(direction)
    try {
      const challenge = await deviceChallenge()
      const signature = await signChallenge(challenge, user.id)

      // Only now, with the biometric already passed.
      let photo: string | null = null
      if (permission?.granted && cameraRef.current) {
        const shot = await cameraRef.current
          .takePictureAsync({ base64: true, quality: 0.5, imageType: "jpg" })
          .catch(() => null)
        if (shot?.base64) photo = `data:image/jpeg;base64,${shot.base64}`
      }

      // The server's own answer, not the fact that a photo was sent: it drops
      // anything over 2MB and still records the punch, so trusting the local
      // variable here would report a photo saved that never was.
      const { photoStored } = await devicePunch(direction, signature, photo)
      await refresh()
      Alert.alert(
        direction === "in" ? "Checked in" : "Checked out",
        photoStored ? "Verified, photo saved" : "Verified"
      )
    } catch (e) {
      const message = (e as Error).message || ""
      // A dismissed prompt is a decision, not a failure worth alarming someone about.
      if (/cancel|user_cancel|authentication|UserFallback/i.test(message) && !/expired/i.test(message)) {
        return
      }
      if (message.toLowerCase().includes("not authenticated") || message.toLowerCase().includes("session")) {
        Alert.alert(
          "Session Expired",
          "Your session has expired or your credentials were updated. Please sign in again.",
          [{ text: "Sign in", onPress: onSignedOut }]
        )
        return
      }
      Alert.alert("Not recorded", message || "Biometric check failed")
    } finally {
      setBusy(null)
    }
  }

  const checkedIn = Boolean(record?.check_in)
  const checkedOut = Boolean(record?.check_out)
  /** Both punches made: there is nothing left today for a photo to be of. */
  const settled = checkedIn && checkedOut

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + scale(12) }]}
    >
      <View style={styles.header}>
        {/* Still, not animated: the mark drops and sways once on the login
            screen, where it is the only thing on screen. Repeating that on the
            screen someone opens every morning to tap two buttons would be
            motion for its own sake. */}
        <Logo size={36} animate={false} />
        <View style={styles.headerText}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.title}>
            Attendance
          </Text>
          {/* One line, ellipsised: a long address must not wrap and push the
              Sign out control off the row. */}
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.email}
          >
            {user.email}
          </Text>
        </View>
        <TouchableOpacity
          onPress={async () => {
            await logout()
            onSignedOut()
          }}
          hitSlop={8}
        >
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signOut}>
            Sign out
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.cardLabel}>
          Today
        </Text>
        <View style={styles.times}>
          <View style={styles.timeCell}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.timeLabel}>
              In
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.time}>
              {formatTime(record?.check_in)}
            </Text>
          </View>
          <View style={styles.timeCell}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.timeLabel}>
              Out
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.time}>
              {formatTime(record?.check_out)}
            </Text>
          </View>
        </View>
      </View>

      {blocked ? (
        <View style={styles.card}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.blocked}>
            {blocked}
          </Text>
        </View>
      ) : enrolled === false ? (
        <TouchableOpacity style={styles.primary} onPress={enrol} disabled={busy !== null}>
          {busy === "enrol" ? (
            <ActivityIndicator color={colors.onFill} />
          ) : (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.primaryText}>
              Set up biometric check-in
            </Text>
          )}
        </TouchableOpacity>
      ) : enrolled === true ? (
        <>
          {/* Mounted only while this tab is in front and a punch is still to
              come. Rendering it otherwise leaves the camera running behind
              whatever else someone is doing. */}
          {settled ? null : permission?.granted ? (
            active ? (
              <View style={styles.preview}>
                <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
              </View>
            ) : (
              // Holds the layout while the tab is in the background, so
              // returning to it does not shift everything up and back.
              <View style={styles.preview} />
            )
          ) : (
            <TouchableOpacity style={styles.subtle} onPress={requestPermission}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.subtleText}>
                Allow the camera to attach a photo to each punch (optional)
              </Text>
            </TouchableOpacity>
          )}

          {/* Two greyed-out buttons say "this screen is broken" rather than
              "your day is recorded". Once both punches are in, the controls
              are replaced by the thing someone actually came to check. */}
          {settled ? (
            <View style={styles.settled}>
              <Ionicons name="checkmark-circle" size={scale(30)} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.settledTitle}>
                  That is today recorded
                </Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.settledSub}>
                  In at {formatTime(record?.check_in)}, out at {formatTime(record?.check_out)}.
                  Nothing further to do until tomorrow.
                </Text>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.primary, (checkedIn || busy !== null) && styles.disabled]}
                onPress={() => punch("in")}
                disabled={checkedIn || busy !== null}
              >
                {busy === "in" ? (
                  <ActivityIndicator color={colors.onFill} />
                ) : (
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.primaryText}>
                    {checkedIn ? `Checked in at ${formatTime(record?.check_in)}` : "Check in"}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondary, (!checkedIn || busy !== null) && styles.disabled]}
                onPress={() => punch("out")}
                disabled={!checkedIn || busy !== null}
              >
                {busy === "out" ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.secondaryText}>
                    Check out
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.note}>
            Your face and fingerprint stay on this phone. It signs the check-in; the
            server only ever sees the signature.
          </Text>
        </>
      ) : (
        <ActivityIndicator style={{ marginTop: scale(24) }} color={colors.accent} />
      )}
    </ScrollView>
  )
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: scale(18), paddingBottom: scale(28), gap: scale(12) },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: scale(12),
    marginBottom: scale(2),
  },
  // flex:1 so the email truncates instead of shoving Sign out off screen.
  headerText: { flex: 1 },
  title: { fontSize: scale(22), fontWeight: "700", color: colors.text },
  email: { fontSize: scale(12), color: colors.muted, marginTop: scale(2) },
  signOut: { fontSize: scale(14), color: colors.accent, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: colors.border,
    padding: scale(14),
  },
  cardLabel: { fontSize: scale(12), color: colors.muted },
  times: { flexDirection: "row", marginTop: scale(8) },
  // Equal halves rather than a fixed gap, so In and Out stay aligned on any width.
  timeCell: { flex: 1 },
  timeLabel: { fontSize: scale(11), color: colors.faint },
  time: { fontSize: scale(20), fontWeight: "600", color: colors.text, marginTop: scale(2) },
  // Aspect ratio rather than a fixed height: a square preview on every screen.
  preview: {
    width: "100%",
    aspectRatio: 1,
    maxHeight: scale(260),
    borderRadius: scale(12),
    overflow: "hidden",
    backgroundColor: colors.border,
  },
  primary: {
    backgroundColor: colors.brand,
    borderRadius: scale(12),
    paddingVertical: scale(15),
    alignItems: "center",
    // A comfortable target on every phone, and the floor Android's own
    // guidance puts on a tappable control.
    minHeight: scale(48),
    justifyContent: "center",
  },
  primaryText: { color: colors.onFill, fontSize: scale(16), fontWeight: "600" },
  secondary: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: scale(12),
    paddingVertical: scale(15),
    alignItems: "center",
    minHeight: scale(48),
    justifyContent: "center",
  },
  secondaryText: { color: colors.accent, fontSize: scale(16), fontWeight: "600" },
  subtle: { backgroundColor: colors.subtle, borderRadius: scale(10), padding: scale(12) },
  subtleText: { color: colors.subtleText, fontSize: scale(12), textAlign: "center" },
  disabled: { opacity: 0.45 },
  settled: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(14),
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: scale(14),
    padding: scale(16),
  },
  settledTitle: { fontSize: scale(15), fontWeight: "700", color: colors.text },
  settledSub: { fontSize: scale(12.5), lineHeight: scale(18), color: colors.muted, marginTop: scale(3) },
  blocked: { color: colors.warn, fontSize: scale(13), lineHeight: scale(19) },
  note: {
    fontSize: scale(11),
    color: colors.muted,
    textAlign: "center",
    lineHeight: scale(16),
    marginTop: scale(2),
  },
})

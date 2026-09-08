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
import * as Location from "expo-location"
import {
  deviceChallenge,
  devicePunch,
  logout,
  registerDevice,
  today as fetchToday,
  type PunchPlace,
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
/** How long a punch will wait for a fresh fix before going without one. */
const LOCATION_DEADLINE_MS = 6000

/**
 * Gives a promise a deadline, resolving null rather than rejecting when it
 * passes.
 *
 * The work is not cancelled — there is no way to cancel a position request —
 * it is simply no longer waited on. Nothing here is worth failing a punch for,
 * so the timeout produces an absent location, not an error.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

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
  /**
   * True only for the second or two between the fingerprint passing and the
   * shutter. The camera is mounted off-screen for exactly that long.
   */
  const [capturing, setCapturing] = useState(false)
  /** Resolved by onCameraReady, so the shot is not taken before there is one. */
  const cameraReady = useRef<(() => void) | null>(null)
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

  /**
   * Takes the attendance photo, and only at the moment it is needed.
   *
   * The camera used to sit on this screen as a live preview from the moment
   * the tab was opened. Someone arriving to press a button was met by their
   * own face instead, which is both alarming and the wrong order: the
   * fingerprint is what authorises a punch, and the photo is evidence
   * attached to one that has already been authorised.
   *
   * So it is mounted off-screen for the second or two it takes to expose a
   * frame, and unmounted again. Off-screen rather than at zero opacity —
   * some devices decline to produce frames for a view they consider
   * invisible, and a photo that silently never arrives is worse than none.
   */
  async function capturePhoto(): Promise<string | null> {
    if (!permission?.granted) return null
    setCapturing(true)
    try {
      // The state change above mounts the camera; this waits for it to say it
      // can actually see. The timeout is the fallback for a device that never
      // fires the callback — a punch must not hang on its photo.
      await new Promise<void>((resolve) => {
        cameraReady.current = resolve
        setTimeout(resolve, 2500)
      })
      const shot = await cameraRef.current
        ?.takePictureAsync({ base64: true, quality: 0.5, imageType: "jpg" })
        .catch(() => null)
      return shot?.base64 ? `data:image/jpeg;base64,${shot.base64}` : null
    } finally {
      cameraReady.current = null
      setCapturing(false)
    }
  }

  /**
   * Where this punch is being made from, if the person allows it.
   *
   * Asked for at the moment of the punch rather than when the tab opens: a
   * permission prompt that arrives while someone is reading their hours is
   * unexplained, and one that arrives as they check in explains itself.
   *
   * Refusal is a normal outcome and returns null. The signature is what
   * authorises attendance, so a punch without coordinates is still a punch —
   * the alternative, refusing to record someone's day because they declined a
   * location prompt, would make this feature a way to lose attendance.
   *
   * Balanced accuracy, not the highest: the question is which building
   * somebody is at, and asking for the best possible fix costs several seconds
   * of GPS settling for precision nobody reads.
   */
  async function capturePlace(): Promise<PunchPlace | null> {
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync()
      if (!granted) return null

      // A cold GPS fix can take the better part of ten seconds, and a punch
      // that sits there while it settles feels broken. Whatever the phone
      // already has is used when it is recent enough to still describe where
      // someone is standing; only a stale or missing one waits for a new fix.
      const known = await Location.getLastKnownPositionAsync({ maxAge: 60_000 })
      const reading =
        known ??
        (await withDeadline(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          LOCATION_DEADLINE_MS
        ))
      if (!reading) return null

      return {
        latitude: reading.coords.latitude,
        longitude: reading.coords.longitude,
        accuracy: reading.coords.accuracy ?? null,
      }
    } catch {
      // No fix indoors, location services off, a timeout. None of these are
      // reasons to stop someone checking in.
      return null
    }
  }

  async function punch(direction: "in" | "out") {
    setBusy(direction)
    try {
      // Started before the fingerprint prompt and collected after it. The fix
      // arrives while someone's finger is on the sensor instead of afterwards,
      // which is the difference between a punch that responds and one that
      // appears to hang.
      //
      // Running it early does not make it part of what authorises the punch:
      // a location is not evidence of identity, it is attached to a signature
      // that has already been checked, and if the signature fails the reading
      // is discarded with everything else.
      const placePromise = capturePlace()

      const challenge = await deviceChallenge()
      const signature = await signChallenge(challenge, user.id)

      // Only now, with the biometric already passed.
      const photo = await capturePhoto()
      const place = await placePromise

      // The server's own answer, not the fact that a photo was sent: it drops
      // anything over 2MB and still records the punch, so trusting the local
      // variable here would report a photo saved that never was.
      const { photoStored, locationStored } = await devicePunch(direction, signature, photo, place)
      await refresh()
      // Says what was actually recorded rather than what was attempted, so
      // someone who declined a permission is told, not quietly assumed.
      const kept = [photoStored ? "photo" : null, locationStored ? "location" : null].filter(Boolean)
      Alert.alert(
        direction === "in" ? "Checked in" : "Checked out",
        kept.length ? `Verified, with ${kept.join(" and ")}` : "Verified"
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
          {/* No preview. A line saying what will happen is enough, and is
              honest about the photo without pointing a live camera at
              someone who came here to press a button. */}
          {settled ? null : permission?.granted ? (
            <View style={styles.cameraNote}>
              <Ionicons name="camera-outline" size={scale(17)} color={colors.muted} />
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.cameraNoteText}>
                A photo and your location are recorded once your fingerprint is
                confirmed, so the record shows where you marked attendance.
              </Text>
            </View>
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

      {/* Off the top of the screen, and only while a shot is being taken. */}
      {capturing && (
        <View style={styles.captureHost} pointerEvents="none">
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="front"
            onCameraReady={() => cameraReady.current?.()}
          />
        </View>
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
  /**
   * Where the shot is actually taken from: a real-sized camera, positioned
   * off the top of the screen. Real-sized because some devices will not
   * produce frames for a view of no size, and off-screen rather than
   * transparent for the same reason.
   */
  captureHost: {
    position: "absolute",
    top: -scale(600),
    left: 0,
    width: scale(200),
    height: scale(200),
  },
  cameraNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(9),
    paddingHorizontal: scale(12),
    paddingVertical: scale(11),
    borderRadius: scale(10),
    backgroundColor: colors.subtle,
  },
  cameraNoteText: { flex: 1, fontSize: scale(12), lineHeight: scale(17), color: colors.subtleText },
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

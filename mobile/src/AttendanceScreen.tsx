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
import { colors, scale, FONT_SCALE_CAP } from "./ui"
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
export function AttendanceScreen({ user, onSignedOut }: { user: SessionUser; onSignedOut: () => void }) {
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

  useEffect(() => {
    refresh()
    isEnrolled(user.id).then(setEnrolled)
    biometricReady().then((r) => setBlocked(r.ok ? null : (r.reason ?? null)))
  }, [refresh, user.id])

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
      Alert.alert("Setup failed", (e as Error).message || "Could not set up this device")
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

      await devicePunch(direction, signature, photo)
      await refresh()
      Alert.alert(
        direction === "in" ? "Checked in" : "Checked out",
        photo ? "Verified, photo saved" : "Verified"
      )
    } catch (e) {
      const message = (e as Error).message || ""
      // A dismissed prompt is a decision, not a failure worth alarming someone about.
      if (/cancel|user_cancel|authentication|UserFallback/i.test(message) && !/expired/i.test(message)) {
        return
      }
      Alert.alert("Not recorded", message || "Biometric check failed")
    } finally {
      setBusy(null)
    }
  }

  const checkedIn = Boolean(record?.check_in)
  const checkedOut = Boolean(record?.check_out)

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
            <ActivityIndicator color="#fff" />
          ) : (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.primaryText}>
              Set up biometric check-in
            </Text>
          )}
        </TouchableOpacity>
      ) : enrolled === true ? (
        <>
          {permission?.granted ? (
            <View style={styles.preview}>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
            </View>
          ) : (
            <TouchableOpacity style={styles.subtle} onPress={requestPermission}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.subtleText}>
                Allow the camera to attach a photo to each punch (optional)
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.primary, (checkedIn || busy !== null) && styles.disabled]}
            onPress={() => punch("in")}
            disabled={checkedIn || busy !== null}
          >
            {busy === "in" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.primaryText}>
                Check in
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondary, (!checkedIn || checkedOut || busy !== null) && styles.disabled]}
            onPress={() => punch("out")}
            disabled={!checkedIn || checkedOut || busy !== null}
          >
            {busy === "out" ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.secondaryText}>
                Check out
              </Text>
            )}
          </TouchableOpacity>

          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.note}>
            Your face and fingerprint stay on this phone. It signs the check-in; the
            server only ever sees the signature.
          </Text>
        </>
      ) : (
        <ActivityIndicator style={{ marginTop: scale(24) }} color={colors.brand} />
      )}
    </ScrollView>
  )
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const styles = StyleSheet.create({
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
  signOut: { fontSize: scale(14), color: colors.brand, fontWeight: "600" },
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
  primaryText: { color: "#fff", fontSize: scale(16), fontWeight: "600" },
  secondary: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: scale(12),
    paddingVertical: scale(15),
    alignItems: "center",
    minHeight: scale(48),
    justifyContent: "center",
  },
  secondaryText: { color: colors.brand, fontSize: scale(16), fontWeight: "600" },
  subtle: { backgroundColor: "#eef2f7", borderRadius: scale(10), padding: scale(12) },
  subtleText: { color: "#475569", fontSize: scale(12), textAlign: "center" },
  disabled: { opacity: 0.45 },
  blocked: { color: colors.warn, fontSize: scale(13), lineHeight: scale(19) },
  note: {
    fontSize: scale(11),
    color: colors.muted,
    textAlign: "center",
    lineHeight: scale(16),
    marginTop: scale(2),
  },
})

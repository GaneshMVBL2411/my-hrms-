import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
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
  fileSource,
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
  const insets = useSafeAreaInsets()

  // Verified punch & photo / location state
  const [photoPreview, setPhotoPreview] = useState<{ uri: string; headers: Record<string, string> } | null>(null)
  const [fullPhotoModal, setFullPhotoModal] = useState<{
    // The source rather than a URL: the request needs its Authorization
    // header, and that travels on the source object.
    source: { uri: string; headers: Record<string, string> }
    time: string
    location?: string
  } | null>(null)

  // Interactive Selfie & Login Location Modal state
  const [verifyModal, setVerifyModal] = useState<{
    visible: boolean
    direction: "in" | "out"
    signature: string
  } | null>(null)
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [loginPlace, setLoginPlace] = useState<{
    coords: PunchPlace | null
    address: string
  }>({ coords: null, address: "Detecting login place GPS..." })
  const [submittingPunch, setSubmittingPunch] = useState(false)

  const refresh = useCallback(async () => {
    const todayRec = await fetchToday(user.employeeId).catch(() => null)
    setRecord(todayRec)
    if (todayRec?.check_in_photo_id) {
      fileSource(todayRec.check_in_photo_id).then(setPhotoPreview).catch(() => null)
    } else {
      setPhotoPreview(null)
    }
  }, [user.employeeId])

  /**
   * Re-read whenever this tab comes to the front, not only on mount.
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
   * Where this punch is being made from, if the person allows it.
   */
  async function capturePlace(): Promise<PunchPlace | null> {
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync()
      if (!granted) return null

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
      return null
    }
  }

  async function punch(direction: "in" | "out") {
    setBusy(direction)
    try {
      // 1. Biometric Authentication first
      const challenge = await deviceChallenge()
      const signature = await signChallenge(challenge, user.id)

      // 2. Biometric passed! Prompt camera and location permissions
      if (!permission?.granted) {
        await requestPermission()
      }
      await Location.requestForegroundPermissionsAsync().catch(() => null)

      // 3. Launch the Selfie & Login Place verification screen
      setCapturedPhoto(null)
      setLoginPlace({ coords: null, address: "Detecting login place GPS..." })
      setVerifyModal({ visible: true, direction, signature })

      // 4. Resolve exact coordinates and place name in background
      capturePlace().then(async (coords) => {
        if (coords) {
          try {
            const geo = await Location.reverseGeocodeAsync({
              latitude: coords.latitude,
              longitude: coords.longitude,
            })
            const first = geo[0]
            const parts = first
              ? [first.street || first.name, first.district || first.subregion || first.city, first.region].filter(Boolean)
              : []
            const addr = parts.length > 0 ? parts.join(", ") : `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`
            setLoginPlace({ coords, address: addr })
          } catch {
            setLoginPlace({ coords, address: `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` })
          }
        } else {
          setLoginPlace({ coords: null, address: "Location fix unavailable" })
        }
      })
    } catch (e) {
      const message = (e as Error).message || ""
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

  async function handleConfirmPunch() {
    if (!verifyModal) return
    setSubmittingPunch(true)
    try {
      const { photoStored, locationStored } = await devicePunch(
        verifyModal.direction,
        verifyModal.signature,
        capturedPhoto,
        loginPlace.coords
      )
      await refresh()
      const dir = verifyModal.direction
      setVerifyModal(null)
      setCapturedPhoto(null)
      const kept = [photoStored ? "selfie photo" : null, locationStored ? "login place" : null].filter(Boolean)
      Alert.alert(
        dir === "in" ? "Checked In Successfully" : "Checked Out Successfully",
        kept.length
          ? `Biometric verified with ${kept.join(" and ")} recorded.`
          : "Biometric attendance verified."
      )
    } catch (e) {
      Alert.alert("Submission Failed", (e as Error).message || "Could not record punch")
    } finally {
      setSubmittingPunch(false)
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
        <View style={styles.cardHeaderRow}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.cardLabel}>
            Today
          </Text>
          {checkedIn && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={scale(13)} color="#00a884" />
              <Text style={styles.verifiedBadgeText}>Biometric Verified</Text>
            </View>
          )}
        </View>

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

          {photoPreview && (
            <TouchableOpacity
              style={styles.todayPhotoWrap}
              onPress={() =>
                setFullPhotoModal({
                  source: photoPreview,
                  time: formatTime(record?.check_in),
                  location:
                    record?.check_in_latitude && record?.check_in_longitude
                      ? `${Number(record.check_in_latitude).toFixed(4)}, ${Number(record.check_in_longitude).toFixed(4)}`
                      : undefined,
                })
              }
              activeOpacity={0.8}
            >
              <Image source={photoPreview} style={styles.todayPhotoThumb} />
              <View style={styles.todayPhotoOverlay}>
                <Ionicons name="camera" size={scale(11)} color="#ffffff" />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {checkedIn && record?.check_in_latitude && record?.check_in_longitude && (
          <View style={styles.todayLocationSection}>
            <View style={styles.todayLocationRow}>
              <Ionicons name="location" size={scale(14)} color="#10b981" />
              <Text numberOfLines={1} style={styles.todayLocationText}>
                Login Place: {Number(record.check_in_latitude).toFixed(4)}, {Number(record.check_in_longitude).toFixed(4)}
                {record.check_in_accuracy_m != null ? ` (±${Math.round(Number(record.check_in_accuracy_m))}m)` : ""}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${record.check_in_latitude},${record.check_in_longitude}`
                  )
                }
              >
                <Text style={styles.mapLink}>View Map ↗</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
          {settled ? (
            <View style={styles.settled}>
              <Ionicons name="checkmark-circle" size={scale(30)} color="#00a884" />
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
                  <View style={styles.btnRow}>
                    <Ionicons name="finger-print" size={scale(20)} color={colors.onFill} />
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.primaryText}>
                      {checkedIn ? `Checked in at ${formatTime(record?.check_in)}` : "Check In with Biometric"}
                    </Text>
                  </View>
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
                  <View style={styles.btnRow}>
                    <Ionicons name="log-out-outline" size={scale(19)} color={colors.accent} />
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.secondaryText}>
                      Check Out
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}

          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.note}>
            Your biometric signs the check-in; after signing, you take a verification selfie and your login place GPS is securely recorded for HR verification.
          </Text>
        </>
      ) : (
        <ActivityIndicator style={{ marginTop: scale(24) }} color={colors.accent} />
      )}

      {/* Interactive Selfie & Login Location Verification Modal */}
      {verifyModal && (
        <Modal
          visible
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => {
            if (!submittingPunch) setVerifyModal(null)
          }}
        >
          <View style={[styles.modalRoot, { paddingTop: insets.top + scale(10), paddingBottom: insets.bottom + scale(14) }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => setVerifyModal(null)}
                disabled={submittingPunch}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={scale(22)} color={colors.text} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={styles.modalTitle}>
                  {verifyModal.direction === "in" ? "Check In Verification" : "Check Out Verification"}
                </Text>
                <Text style={styles.modalSubTitle}>Biometric confirmed · Take attendance picture</Text>
              </View>
              <View style={{ width: scale(36) }} />
            </View>

            {/* Login Place GPS Banner */}
            <View style={styles.modalPlaceCard}>
              <View style={styles.modalPlaceDot} />
              <Ionicons name="location-sharp" size={scale(18)} color="#10b981" />
              <View style={{ flex: 1 }}>
                <Text style={styles.modalPlaceLabel}>LOGIN PLACE GPS</Text>
                <Text numberOfLines={1} style={styles.modalPlaceAddress}>
                  {loginPlace.address}
                  {loginPlace.coords?.accuracy != null ? ` (±${Math.round(loginPlace.coords.accuracy)}m)` : ""}
                </Text>
              </View>
            </View>

            {/* Camera Viewport / Captured Image Preview */}
            <View style={styles.cameraContainer}>
              {!capturedPhoto ? (
                permission?.granted ? (
                  <View style={styles.cameraFrame}>
                    <CameraView
                      ref={cameraRef}
                      facing="front"
                      style={StyleSheet.absoluteFill}
                    />
                    {/* Face Guide Oval */}
                    <View pointerEvents="none" style={styles.faceOval} />
                    <View style={styles.cameraFaceHintWrap}>
                      <Text style={styles.cameraFaceHint}>Position your face in the oval</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.cameraPermissionDenied}>
                    <Ionicons name="camera-outline" size={scale(48)} color={colors.muted} />
                    <Text style={styles.cameraDeniedText}>
                      Camera access is required to take your biometric attendance selfie photo.
                    </Text>
                    <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
                      <Text style={styles.grantBtnText}>Grant Camera Permission</Text>
                    </TouchableOpacity>
                  </View>
                )
              ) : (
                <View style={styles.cameraFrame}>
                  <Image source={{ uri: capturedPhoto }} style={StyleSheet.absoluteFill} />
                  <View style={styles.capturedBadge}>
                    <Ionicons name="checkmark-circle" size={scale(18)} color="#10b981" />
                    <Text style={styles.capturedBadgeText}>Photo Captured</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Bottom Controls */}
            <View style={styles.modalBottomBar}>
              {!capturedPhoto ? (
                <View style={styles.shutterRow}>
                  <TouchableOpacity
                    style={styles.shutterBtn}
                    onPress={async () => {
                      if (!permission?.granted) {
                        await requestPermission()
                        return
                      }
                      const shot = await cameraRef.current
                        ?.takePictureAsync({ base64: true, quality: 0.5, imageType: "jpg" })
                        .catch(() => null)
                      if (shot?.base64) {
                        setCapturedPhoto(`data:image/jpeg;base64,${shot.base64}`)
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.shutterInner} />
                  </TouchableOpacity>
                  <Text style={styles.shutterLabel}>Tap button to take picture</Text>
                </View>
              ) : (
                <View style={styles.confirmRow}>
                  <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={() => setCapturedPhoto(null)}
                    disabled={submittingPunch}
                  >
                    <Ionicons name="refresh" size={scale(18)} color={colors.text} />
                    <Text style={styles.retakeBtnText}>Retake</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.confirmPunchBtn}
                    onPress={handleConfirmPunch}
                    disabled={submittingPunch}
                  >
                    {submittingPunch ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={scale(19)} color="#ffffff" />
                        <Text style={styles.confirmPunchBtnText}>Confirm & Submit</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Full Resolution Photo Modal */}
      {fullPhotoModal && (
        <Modal
          transparent
          visible
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setFullPhotoModal(null)}
        >
          <Pressable style={styles.photoModalBackdrop} onPress={() => setFullPhotoModal(null)}>
            <View style={styles.photoModalCard}>
              <View style={styles.photoModalHeader}>
                <View>
                  <Text style={styles.photoModalTitle}>Check In Selfie</Text>
                  <Text style={styles.photoModalSub}>Time: {fullPhotoModal.time}</Text>
                </View>
                <TouchableOpacity onPress={() => setFullPhotoModal(null)} style={styles.photoModalClose}>
                  <Ionicons name="close" size={scale(20)} color={colors.text} />
                </TouchableOpacity>
              </View>

              <Image source={fullPhotoModal.source} style={styles.photoModalImage} />

              {fullPhotoModal.location && (
                <View style={styles.photoModalLocRow}>
                  <Ionicons name="location" size={scale(15)} color="#10b981" />
                  <Text style={styles.photoModalLocText}>Login Place: {fullPhotoModal.location}</Text>
                </View>
              )}
            </View>
          </Pressable>
        </Modal>
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
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLabel: { fontSize: scale(12), color: colors.muted },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(4),
    backgroundColor: "rgba(0,168,132,0.1)",
    paddingHorizontal: scale(8),
    paddingVertical: scale(3),
    borderRadius: scale(10),
  },
  verifiedBadgeText: {
    fontSize: scale(11),
    fontWeight: "600",
    color: "#00a884",
  },
  times: { flexDirection: "row", marginTop: scale(8), alignItems: "center" },
  timeCell: { flex: 1 },
  timeLabel: { fontSize: scale(11), color: colors.faint },
  time: { fontSize: scale(20), fontWeight: "600", color: colors.text, marginTop: scale(2) },
  todayPhotoWrap: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(24),
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.brand,
    position: "relative",
  },
  todayPhotoThumb: {
    width: "100%",
    height: "100%",
  },
  todayPhotoOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    left: 0,
    height: scale(14),
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  todayLocationSection: {
    marginTop: scale(10),
    paddingTop: scale(8),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  todayLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
  },
  todayLocationText: {
    flex: 1,
    fontSize: scale(12),
    color: colors.muted,
  },
  mapLink: {
    fontSize: scale(12),
    fontWeight: "600",
    color: colors.accent,
  },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
  },
  primary: {
    backgroundColor: colors.brand,
    borderRadius: scale(12),
    paddingVertical: scale(15),
    alignItems: "center",
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

  // Interactive Verification Modal
  modalRoot: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: scale(16),
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: scale(8),
  },
  modalCloseBtn: {
    padding: scale(6),
  },
  modalTitle: {
    fontSize: scale(16),
    fontWeight: "700",
    color: colors.text,
  },
  modalSubTitle: {
    fontSize: scale(11.5),
    color: colors.muted,
    marginTop: scale(1),
  },
  modalPlaceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(12),
    padding: scale(10),
    marginVertical: scale(6),
  },
  modalPlaceDot: {
    width: scale(8),
    height: scale(8),
    borderRadius: scale(4),
    backgroundColor: "#10b981",
  },
  modalPlaceLabel: {
    fontSize: scale(9.5),
    fontWeight: "700",
    color: "#10b981",
    letterSpacing: 0.5,
  },
  modalPlaceAddress: {
    fontSize: scale(12.5),
    fontWeight: "600",
    color: colors.text,
    marginTop: scale(1),
  },
  cameraContainer: {
    flex: 1,
    borderRadius: scale(20),
    overflow: "hidden",
    backgroundColor: "#000000",
    position: "relative",
    marginVertical: scale(6),
  },
  cameraFrame: {
    flex: 1,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  faceOval: {
    width: scale(200),
    height: scale(250),
    borderRadius: scale(100),
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.75)",
    borderStyle: "dashed",
    position: "absolute",
  },
  cameraFaceHintWrap: {
    position: "absolute",
    bottom: scale(14),
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: scale(14),
    paddingVertical: scale(6),
    borderRadius: scale(16),
  },
  cameraFaceHint: {
    color: "#ffffff",
    fontSize: scale(12),
    fontWeight: "500",
  },
  cameraPermissionDenied: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: scale(24),
    gap: scale(12),
  },
  cameraDeniedText: {
    color: "#ffffff",
    fontSize: scale(13),
    textAlign: "center",
    lineHeight: scale(19),
  },
  grantBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: scale(18),
    paddingVertical: scale(10),
    borderRadius: scale(10),
  },
  grantBtnText: {
    color: colors.onFill,
    fontSize: scale(13),
    fontWeight: "600",
  },
  capturedBadge: {
    position: "absolute",
    top: scale(14),
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: scale(12),
    paddingVertical: scale(6),
    borderRadius: scale(20),
  },
  capturedBadgeText: {
    color: "#ffffff",
    fontSize: scale(12),
    fontWeight: "600",
  },
  modalBottomBar: {
    paddingVertical: scale(12),
  },
  shutterRow: {
    alignItems: "center",
    gap: scale(8),
  },
  shutterBtn: {
    width: scale(68),
    height: scale(68),
    borderRadius: scale(34),
    borderWidth: 4,
    borderColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  shutterInner: {
    width: scale(52),
    height: scale(52),
    borderRadius: scale(26),
    backgroundColor: colors.brand,
  },
  shutterLabel: {
    fontSize: scale(12),
    color: colors.muted,
    fontWeight: "500",
  },
  confirmRow: {
    flexDirection: "row",
    gap: scale(12),
  },
  retakeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(6),
    backgroundColor: colors.subtle,
    paddingVertical: scale(14),
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: colors.border,
  },
  retakeBtnText: {
    fontSize: scale(15),
    fontWeight: "600",
    color: colors.text,
  },
  confirmPunchBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(6),
    backgroundColor: "#00a884",
    paddingVertical: scale(14),
    borderRadius: scale(12),
  },
  confirmPunchBtnText: {
    fontSize: scale(15),
    fontWeight: "700",
    color: "#ffffff",
  },

  // Photo Preview Modal
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: scale(20),
  },
  photoModalCard: {
    width: "100%",
    maxWidth: scale(340),
    backgroundColor: colors.card,
    borderRadius: scale(16),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: scale(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  photoModalTitle: {
    fontSize: scale(15),
    fontWeight: "700",
    color: colors.text,
  },
  photoModalSub: {
    fontSize: scale(11.5),
    color: colors.muted,
    marginTop: scale(1),
  },
  photoModalClose: {
    padding: scale(4),
  },
  photoModalImage: {
    width: "100%",
    height: scale(300),
    backgroundColor: "#000000",
  },
  photoModalLocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
    padding: scale(12),
    backgroundColor: colors.subtle,
  },
  photoModalLocText: {
    fontSize: scale(12),
    color: colors.text,
    flex: 1,
  },
})

import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { logout, select, type SessionUser } from "./api"
import { forgetDeviceKey, gateMode, isEnrolled } from "./device"
import { colors, scale, FONT_SCALE_CAP } from "./ui"

interface Profile {
  full_name: string | null
  employee_code: string | null
  designation_title: string | null
  department_name: string | null
  joining_date: string | null
  phone: string | null
}

/**
 * Who is signed in, and the two things only this screen can do: sign out, and
 * detach this phone from the account.
 *
 * A sheet over the tabs rather than a fifth tab. It is opened a few times a
 * month, and a permanent tab spends its width every day to say so.
 *
 * The device row is here because this is the screen someone reaches when the
 * phone is behaving as though it belongs to somebody else — which, on a shared
 * handset, it may: the key is enrolled to whoever set it up, and "Set up" on
 * the Check in tab is offered only to that person until the key is removed.
 */
export function ProfileScreen({
  user,
  onClose,
  onSignedOut,
}: {
  user: SessionUser
  onClose: () => void
  onSignedOut: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrolled, setEnrolled] = useState<boolean | null>(null)
  const [gate, setGate] = useState<"keystore" | "prompt" | null>(null)
  const [busy, setBusy] = useState(false)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (user.employeeId === null) {
      setProfile(null)
      return
    }
    select<Profile>("employee_directory", {
      columns: "full_name, employee_code, designation_title, department_name, joining_date, phone",
      filters: [{ column: "id", op: "eq", value: user.employeeId }],
      limit: 1,
    })
      .then((rows) => setProfile(rows[0] ?? null))
      .catch(() => setProfile(null))
    isEnrolled(user.id).then(setEnrolled)
    gateMode(user.id).then(setGate)
  }, [user.id, user.employeeId])

  const name = profile?.full_name ?? user.email

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top + scale(8) }]}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.barTitle}>
            Profile
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={scale(24)} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + scale(24) }]}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.avatarText}>
                {initials(name)}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.name}>
              {name}
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.email}>
              {user.email}
            </Text>
            <View style={styles.rolePill}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.roleText}>
                {user.role.replace(/_/g, " ")}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Field label="Employee code" value={profile?.employee_code} />
            <Field label="Designation" value={profile?.designation_title} />
            <Field label="Department" value={profile?.department_name} />
            <Field label="Joined" value={profile?.joining_date?.slice(0, 10)} />
            <Field label="Phone" value={profile?.phone} last />
          </View>

          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.section}>
            This device
          </Text>
          <View style={styles.card}>
            <View style={styles.deviceRow}>
              <Ionicons
                name={enrolled ? "finger-print" : "finger-print-outline"}
                size={scale(22)}
                color={enrolled ? colors.brand : colors.faint}
              />
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.deviceTitle}>
                  {enrolled === null
                    ? "Checking…"
                    : enrolled
                      ? "Set up for your check-in"
                      : "Not set up for you"}
                </Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.deviceSub}>
                  {enrolled
                    ? gate === "prompt"
                      ? "Your fingerprint is asked for before each punch."
                      : "Your key is held behind the phone's own lock."
                    : "Open Check in to set this phone up for your account."}
                </Text>
              </View>
            </View>
            {enrolled && (
              <TouchableOpacity
                style={styles.deviceBtn}
                onPress={() =>
                  Alert.alert(
                    "Remove this device?",
                    "You will need to set it up again before you can punch with a fingerprint. Do this if the phone is being handed to someone else.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: async () => {
                          await forgetDeviceKey(user.id)
                          setEnrolled(false)
                        },
                      },
                    ]
                  )
                }
              >
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.deviceBtnText}>
                  Remove this device
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.signOut, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={async () => {
              setBusy(true)
              try {
                // The device key stays. It belongs to this account, and someone
                // signing back in on their own phone should not have to set it
                // up again — the owner check is what keeps it from being used
                // by whoever signs in next.
                await logout()
                onSignedOut()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={scale(20)} color="#fff" />
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signOutText}>
                  Sign out
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}

function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, last && { borderBottomWidth: 0 }]}>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.fieldLabel}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.fieldValue}>
        {value || "—"}
      </Text>
    </View>
  )
}

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: scale(18),
    paddingBottom: scale(10),
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  barTitle: { fontSize: scale(18), fontWeight: "700", color: colors.text },
  content: { padding: scale(18), gap: scale(14) },

  identity: { alignItems: "center", gap: scale(6), paddingVertical: scale(10) },
  avatar: {
    width: scale(72),
    height: scale(72),
    borderRadius: scale(36),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: scale(24), fontWeight: "700" },
  name: { fontSize: scale(20), fontWeight: "700", color: colors.text, textAlign: "center" },
  email: { fontSize: scale(13), color: colors.muted, textAlign: "center" },
  rolePill: {
    marginTop: scale(4),
    paddingHorizontal: scale(12),
    paddingVertical: scale(4),
    borderRadius: scale(999),
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  roleText: { fontSize: scale(12), color: colors.muted, textTransform: "capitalize" },

  section: { fontSize: scale(13), fontWeight: "600", color: colors.muted, marginTop: scale(4) },
  card: {
    backgroundColor: colors.card,
    borderRadius: scale(14),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: scale(14),
  },
  field: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: scale(12),
    paddingVertical: scale(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: { fontSize: scale(13), color: colors.muted },
  fieldValue: { flex: 1, textAlign: "right", fontSize: scale(14), fontWeight: "600", color: colors.text },

  deviceRow: { flexDirection: "row", alignItems: "center", gap: scale(12), paddingVertical: scale(14) },
  deviceTitle: { fontSize: scale(14), fontWeight: "600", color: colors.text },
  deviceSub: { fontSize: scale(12), color: colors.muted, marginTop: scale(2) },
  deviceBtn: {
    paddingVertical: scale(12),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  deviceBtnText: { fontSize: scale(14), fontWeight: "600", color: colors.danger },

  signOut: {
    marginTop: scale(6),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(8),
    backgroundColor: colors.brand,
    borderRadius: scale(14),
    paddingVertical: scale(15),
  },
  signOutText: { color: "#fff", fontSize: scale(16), fontWeight: "700" },
})

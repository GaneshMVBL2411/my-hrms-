import { useEffect, useState } from "react"
import { ActivityIndicator, BackHandler, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { Ionicons } from "@expo/vector-icons"
import { LoginScreen } from "./src/LoginScreen"
import { AttendanceScreen } from "./src/AttendanceScreen"
import { HomeScreen } from "./src/HomeScreen"
import { ProfileScreen } from "./src/ProfileScreen"
import { BrowseScreen } from "./src/BrowseScreen"
import { PortalScreen } from "./src/PortalScreen"
import { MessagesScreen } from "./src/MessagesScreen"
import { me, setUnauthorizedHandler, type SessionUser } from "./src/api"
import { scale, FONT_SCALE_CAP } from "./src/ui"
import { ThemeProvider, useStyles, useTheme, type Palette } from "./src/theme"

/**
 * The native HRMS app: sign in once, then either punch in with a fingerprint or
 * face, or work through the full portal — same API, same database as the web.
 *
 * Four tabs, and the split between them is deliberate rather than half-finished:
 *
 *   Home      today at a glance and the handful of things people came to do.
 *             It routes and owns nothing, so there is one implementation of
 *             each destination rather than a dashboard copy of it
 *   Check in  native, because the entire point is reaching the phone's biometric
 *             sensor and its keystore, which a web page in a WebView cannot do
 *   Modules   native lists for the ten sections that read well on a phone.
 *             Worth writing a second time: real scrolling, no page load on every
 *             tab, and rows laid out for a narrow screen instead of a table
 *             squeezed onto one
 *   Portal    the web app, for everything not ported yet. Keeping it is the
 *             honest option; the alternative is claiming forty screens exist
 *             natively when ten do
 *
 * A hand-rolled tab bar rather than a navigation library: with four tabs and one
 * level of drill-down, react-navigation would be four dependencies to replace a
 * dozen lines of state.
 *
 * SafeAreaProvider wraps everything because React Native's own SafeAreaView does
 * nothing on Android — the screens below read real insets from this instead, so
 * the header clears the status bar and the tab bar clears the gesture pill.
 *
 * ThemeProvider sits inside it and above every screen, because the palette is
 * read through a hook rather than imported: a screen that imported its colours
 * would keep whichever theme was current when its file first loaded.
 */
type Tab = "home" | "punch" | "browse" | "chat" | "portal"

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "home", label: "Home", icon: "home-outline" },
  { key: "punch", label: "Check in", icon: "finger-print-outline" },
  { key: "browse", label: "Modules", icon: "grid-outline" },
  // A tab rather than a row inside Modules: a message nobody is told about is a
  // message nobody reads, and only a tab can carry the unread count where it
  // will actually be seen.
  { key: "chat", label: "Messages", icon: "chatbubble-ellipses-outline" },
  { key: "portal", label: "Portal", icon: "globe-outline" },
]

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

function Shell() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState<Tab>("home")
  const [browseKey, setBrowseKey] = useState<string | null>(null)
  const [browseAction, setBrowseAction] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const insets = useSafeAreaInsets()
  const { colors, isDark } = useTheme()
  const styles = useStyles(makeStyles)

  /**
   * Android's back gesture, which until now closed the app from anywhere.
   *
   * With a hand-rolled tab bar there is no navigator to unwind, so nothing
   * claimed the press and it fell through to the OS default — quitting, even
   * three levels into Modules. The screens register their own handlers for
   * their internal depth; this is the last one to run, and it treats Home as
   * the bottom of the stack the way a tabbed app does.
   *
   * Returning false is what actually lets the app close, so Home still exits
   * on the first press rather than trapping anyone in it.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (profileOpen) {
        setProfileOpen(false)
        return true
      }
      if (tab !== "home") {
        setTab("home")
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [profileOpen, tab])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      setTab("home")
    })

    // A stored token survives a restart, so the app opens on the punch screen
    // rather than asking someone to sign in every morning.
    me()
      .then(setUser)
      .finally(() => setChecking(false))

    return () => setUnauthorizedHandler(null)
  }, [])

  if (checking) {
    return (
      <View style={styles.centre}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <LoginScreen onSignedIn={setUser} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={styles.body}>
        {/* Both stay mounted: unmounting the portal would throw away its
            scroll position and reload the whole SPA on every tab switch. */}
        <View
          style={[styles.page, tab !== "home" && styles.hidden]}
          pointerEvents={tab === "home" ? "auto" : "none"}
        >
          {/* Home routes rather than owns: it names a destination and the tab
              that owns it opens it. "Payslips" lands on payslips, not on the
              grid with payslips somewhere in it. */}
          <HomeScreen
            user={user}
            onOpenProfile={() => setProfileOpen(true)}
            onGo={(t) => {
              if (t === "punch") return setTab("punch")
              if (t === "issue-letter") {
                setBrowseKey("letters")
                setBrowseAction(true)
                return setTab("browse")
              }
              setBrowseKey(t === "browse" ? null : t)
              setBrowseAction(false)
              setTab("browse")
            }}
          />
        </View>
        <View
          style={[styles.page, tab !== "punch" && styles.hidden]}
          pointerEvents={tab === "punch" ? "auto" : "none"}
        >
          <AttendanceScreen active={tab === "punch"} user={user} onSignedOut={() => setUser(null)} />
        </View>
        <View
          style={[styles.page, tab !== "browse" && styles.hidden]}
          pointerEvents={tab === "browse" ? "auto" : "none"}
        >
          <BrowseScreen
            active={tab === "browse"}
            user={user}
            jumpTo={browseKey}
            initialAction={browseAction}
            onJumped={() => {
              setBrowseKey(null)
              setBrowseAction(false)
            }}
          />
        </View>
        <View
          style={[styles.page, tab !== "chat" && styles.hidden]}
          pointerEvents={tab === "chat" ? "auto" : "none"}
        >
          {/* Mounted from the start, not on first open: it is what polls for
              new messages, and a badge that only appears once you have already
              looked is no use. Keyed by account so a new sign-in never inherits
              the previous person's conversations. */}
          <MessagesScreen key={user.id} active={tab === "chat"} user={user} onUnread={setUnread} />
        </View>
        <View
          style={[styles.page, tab !== "portal" && styles.hidden]}
          pointerEvents={tab === "portal" ? "auto" : "none"}
        >
          {/* Keyed by account: a new sign-in gets a new WebView rather than
              the one the previous person left behind. */}
          <PortalScreen key={user.id} userId={user.id} />
        </View>
      </View>

      {profileOpen && (
        <ProfileScreen
          user={user}
          onClose={() => setProfileOpen(false)}
          onSignedOut={() => {
            // Close first: the sheet is a Modal over the tabs, and leaving it up
            // while the tree swaps to the login screen would hide the form
            // behind it.
            setProfileOpen(false)
            setUser(null)
            setTab("home")
          }}
        />
      )}

      {/* The inset is added to the padding rather than replacing it, so the
          labels sit above the gesture pill on a phone that has one and keep
          their normal spacing on a phone that does not. */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom + scale(6) }]}>
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            label={t.label}
            icon={t.icon}
            active={tab === t.key}
            badge={t.key === "chat" ? unread : 0}
            onPress={() => setTab(t.key)}
          />
        ))}
      </View>
    </View>
  )
}

function TabButton({
  label,
  icon,
  active,
  badge = 0,
  onPress,
}: {
  label: string
  icon: keyof typeof Ionicons.glyphMap
  active: boolean
  /** Unread count shown on the icon. Zero renders nothing. */
  badge?: number
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)

  return (
    <TouchableOpacity
      style={styles.tab}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      {/* The filled variant for the active tab: a colour change alone is easy
          to miss, and is invisible to anyone who cannot distinguish the two. */}
      <View>
        <Ionicons
          name={active ? (icon.replace("-outline", "") as keyof typeof Ionicons.glyphMap) : icon}
          size={scale(21)}
          color={active ? colors.accent : colors.faint}
        />
        {badge > 0 && (
          <View style={styles.tabBadge}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.tabBadgeText}>
              {badge > 9 ? "9+" : badge}
            </Text>
          </View>
        )}
      </View>
      <Text
        maxFontSizeMultiplier={FONT_SCALE_CAP}
        style={[styles.tabText, active && styles.tabTextActive]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  page: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // display:none rather than unmounting, so the WebView keeps its state.
  hidden: { display: "none" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingTop: scale(10),
  },
  tab: { flex: 1, alignItems: "center", gap: scale(3), paddingTop: scale(2) },
  tabText: { fontSize: scale(10), fontWeight: "600", color: colors.faint },
  // Sits on the icon's top-right corner. Absolute against the icon's own View
  // so it travels with it whatever the tab bar's width works out to be.
  tabBadge: {
    position: "absolute",
    top: -scale(4),
    right: -scale(9),
    minWidth: scale(16),
    height: scale(16),
    borderRadius: scale(8),
    paddingHorizontal: scale(4),
    backgroundColor: colors.dangerFill,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: { color: colors.onFill, fontSize: scale(9), fontWeight: "700" },
  tabTextActive: { color: colors.accent },
})

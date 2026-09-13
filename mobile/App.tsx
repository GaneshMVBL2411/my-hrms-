import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Easing,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import Svg, { Path } from "react-native-svg"
import { LoginScreen } from "./src/LoginScreen"
import { AttendanceScreen } from "./src/AttendanceScreen"
import { HomeScreen } from "./src/HomeScreen"
import { ProfileScreen } from "./src/ProfileScreen"
import { BrowseScreen } from "./src/BrowseScreen"
import { PortalScreen } from "./src/PortalScreen"
import { MessagesScreen } from "./src/MessagesScreen"
import { me, setUnauthorizedHandler, touchPresence, type SessionUser } from "./src/api"
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
/**
 * How often the app says it is open.
 *
 * Comfortably inside the server's 75-second window, so one missed beat does
 * not flicker somebody offline and back.
 */
const PRESENCE_INTERVAL_MS = 45_000

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
   * Android's back gesture, which before this closed the app from anywhere.
   *
   * With a hand-rolled tab bar there is no navigator to unwind, so nothing
   * claimed the press and it fell through to the OS default — quitting, even
   * three levels into Modules. The screens handle their own internal depth;
   * this is the fallback beneath all of them, and it treats Home as the bottom
   * of the stack the way a tabbed app does.
   *
   * Registered once, with the live values read from a ref rather than from the
   * closure. That is not a detail: BackHandler calls the most recently added
   * listener first, so an effect that re-subscribed on every tab change kept
   * jumping ahead of the screens' own handlers, and back from an open module
   * would have gone to Home instead of closing the module. Subscribing once at
   * mount makes this permanently the oldest listener, and therefore the last
   * one consulted.
   *
   * Returning false is what actually lets the app close, so Home still exits
   * on the first press rather than trapping anyone in it.
   */
  const backState = useRef({ profileOpen, tab })
  backState.current = { profileOpen, tab }

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (backState.current.profileOpen) {
        setProfileOpen(false)
        return true
      }
      if (backState.current.tab !== "home") {
        setTab("home")
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [])

  /**
   * Tells the server this app is open, for as long as it is.
   *
   * Here rather than in the chat screen because that is what presence means:
   * someone is reachable when the app is open, not when they happen to be
   * looking at a conversation. Putting it in Messages would have shown people
   * as offline while they were reading their attendance.
   *
   * There is deliberately no "going offline" call. The server stores the last
   * time it heard, not a flag, so stopping the beat is the whole mechanism —
   * which means a killed app, a flat battery and a tunnel all resolve the same
   * correct way, without any of them getting the chance to run cleanup code.
   *
   * Beating pauses in the background: a phone in a pocket is not somewhere a
   * message will be read, and saying otherwise is the thing being fixed.
   */
  useEffect(() => {
    if (!user) return

    let live = true
    const beat = () => {
      if (live && AppState.currentState === "active") touchPresence().catch(() => undefined)
    }

    beat()
    const timer = setInterval(beat, PRESENCE_INTERVAL_MS)
    // Foreground again, and say so at once rather than up to a minute later.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") beat()
    })

    return () => {
      live = false
      clearInterval(timer)
      sub.remove()
    }
  }, [user])

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

  useEffect(() => {
    if (Platform.OS === "android") {
      StatusBar.setTranslucent(true)
      StatusBar.setBackgroundColor("transparent", true)
    }
  }, [])

  if (checking) {
    return (
      <View style={styles.centre}>
        <StatusBar
          barStyle={isDark ? "light-content" : "dark-content"}
          backgroundColor="transparent"
          translucent
        />
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <StatusBar
          barStyle={isDark ? "light-content" : "dark-content"}
          backgroundColor="transparent"
          translucent
        />
        <LoginScreen onSignedIn={setUser} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor="transparent"
        translucent
      />
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
            active={tab === "home"}
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
          <PortalScreen key={user.id} active={tab === "portal"} userId={user.id} />
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
            tabKey={t.key}
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
  tabKey,
  label,
  icon,
  active,
  badge = 0,
  onPress,
}: {
  tabKey: Tab
  label: string
  icon: keyof typeof Ionicons.glyphMap
  active: boolean
  /** Unread count shown on the icon. Zero renders nothing. */
  badge?: number
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const anim = useRef(new Animated.Value(0)).current

  const playTabMotion = useCallback(() => {
    anim.setValue(0)
    Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: tabKey === "punch" ? 650 : tabKey === "browse" ? 380 : 280,
        easing: tabKey === "punch" ? Easing.bezier(0.25, 1, 0.5, 1) : Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(anim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start()
  }, [anim, tabKey])

  useEffect(() => {
    if (active) {
      playTabMotion()
    }
  }, [active, playTabMotion])

  const handlePress = () => {
    playTabMotion()
    onPress()
  }

  // Clean, stable tactile micro-interactions (NO shaking / jittering)
  const getTransform = () => {
    switch (tabKey) {
      case "chat": // Messages - Smooth, non-shaking scale tap
        return [
          {
            scale: anim.interpolate({
              inputRange: [0, 0.45, 1],
              outputRange: [1, 1.15, 1],
            }),
          },
        ]

      case "home": // Home - Clean gentle scale, no shaking
        return [
          {
            scale: anim.interpolate({
              inputRange: [0, 0.45, 1],
              outputRange: [1, 1.12, 1],
            }),
          },
        ]

      case "portal": // Portal - Smooth, steady scale, no wobble
        return [
          {
            scale: anim.interpolate({
              inputRange: [0, 0.45, 1],
              outputRange: [1, 1.14, 1],
            }),
          },
        ]

      default:
        return [
          {
            scale: anim.interpolate({
              inputRange: [0, 0.45, 1],
              outputRange: [1, 1.12, 1],
            }),
          },
        ]
    }
  }

  return (
    <TouchableOpacity
      style={styles.tab}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <View style={styles.iconBox}>
        {tabKey === "punch" ? (
          <BiometricPunchIcon
            active={active}
            anim={anim}
            color={active ? colors.accent : colors.faint}
          />
        ) : tabKey === "browse" ? (
          <ModuleGridIcon
            active={active}
            anim={anim}
            color={active ? colors.accent : colors.faint}
          />
        ) : (
          <Animated.View style={{ transform: getTransform() }}>
            <Ionicons
              name={active ? (icon.replace("-outline", "") as keyof typeof Ionicons.glyphMap) : icon}
              size={scale(22)}
              color={active ? colors.accent : colors.faint}
            />
          </Animated.View>
        )}
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

/**
 * Module icon with 4 animated dots/tiles in a 2x2 grid.
 * When clicked:
 * - First dot (top-left) moves to the right side
 * - Second dot (top-right) moves down
 * - Third dot (bottom-right) moves to the left
 * - Fourth dot (bottom-left) moves up
 * Each dot locks into the next corner with an elastic spring.
 */
function ModuleGridIcon({
  active,
  anim,
  color,
}: {
  active: boolean
  anim: Animated.Value
  color: string
}) {
  const styles = useStyles(makeStyles)
  const D = scale(9.5) // Distance between dot centers

  // Pure, smooth directional slides (NO shaking / jittering):
  // Dot 1 (Top-Left): slides directly to the right side
  const dot1X = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, D],
  })

  // Dot 2 (Top-Right): slides directly down
  const dot2Y = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, D],
  })

  // Dot 3 (Bottom-Right): slides directly to the left
  const dot3X = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -D],
  })

  // Dot 4 (Bottom-Left): slides directly up
  const dot4Y = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -D],
  })

  return (
    <View style={styles.moduleGridBox} pointerEvents="none">
      {/* Dot 1: Top-Left (moves right) */}
      <Animated.View
        style={[
          styles.moduleDot,
          {
            left: scale(2),
            top: scale(2),
            backgroundColor: color,
            transform: [{ translateX: dot1X }],
          },
        ]}
      />

      {/* Dot 2: Top-Right (moves down) */}
      <Animated.View
        style={[
          styles.moduleDot,
          {
            left: scale(2) + D,
            top: scale(2),
            backgroundColor: color,
            transform: [{ translateY: dot2Y }],
          },
        ]}
      />

      {/* Dot 3: Bottom-Right (moves left) */}
      <Animated.View
        style={[
          styles.moduleDot,
          {
            left: scale(2) + D,
            top: scale(2) + D,
            backgroundColor: color,
            transform: [{ translateX: dot3X }],
          },
        ]}
      />

      {/* Dot 4: Bottom-Left (moves up) */}
      <Animated.View
        style={[
          styles.moduleDot,
          {
            left: scale(2),
            top: scale(2) + D,
            backgroundColor: color,
            transform: [{ translateY: dot4Y }],
          },
        ]}
      />
    </View>
  )
}

/**
 * The 5 individual curved ridge lines of the biometric fingerprint icon.
 * Used to illuminate and rotate light directly along the thumb lines
 * without any round circular shapes on or around the icon.
 */
const FP_TOP = "M398.18,48.79C385.5,40.54,340.54,16,256,16c-88.74,0-133.81,27.11-143.78,34a11.59,11.59,0,0,0-1.84,1.4.36.36,0,0,1-.22.1,14.87,14.87,0,0,0-5.09,11.15A15.06,15.06,0,0,0,120.38,77.5a15.56,15.56,0,0,0,8.88-2.79c.43-.32,39.22-28.82,126.77-28.82S382.58,74.29,383,74.5a15.25,15.25,0,0,0,9.21,3A15.06,15.06,0,0,0,407.5,62.61,14.9,14.9,0,0,0,398.18,48.79Z"
const FP_UPPER = "M63.28,202a15.29,15.29,0,0,1-7.7-2,14.84,14.84,0,0,1-5.52-20.46C69.34,147.36,128,72.25,256,72.25c55.47,0,104.12,14.57,144.53,43.29,33.26,23.57,51.9,50.25,60.78,63.1a14.79,14.79,0,0,1-4,20.79,15.52,15.52,0,0,1-21.24-4C420,172.32,371,102,256,102c-112.25,0-163,64.71-179.53,92.46A15,15,0,0,1,63.28,202Z"
const FP_RIGHT_HOOK = "M372.5,446.18c-32.5,0-60.13-9-82.24-26.89-44.42-35.79-49.4-94.08-49.62-96.54a15.27,15.27,0,0,1,30.45-2.36c.11.86,4.55,48.54,38.79,76,20.26,16.18,47.34,22.6,80.71,18.85a15.2,15.2,0,0,1,16.91,13.18,14.92,14.92,0,0,1-13.44,16.5A187,187,0,0,1,372.5,446.18Z"
const FP_LEFT_LOOP = "M201.31,489.14a15.5,15.5,0,0,1-11.16-4.71c-37.16-39-58.18-82.61-66.09-137.14V347c-4.44-36.1,2.06-87.21,33.91-122.35,23.51-25.93,56.56-39.11,98.06-39.11,49.08,0,87.65,22.82,111.7,65.89,17.45,31.29,20.91,62.47,21,63.75a15.07,15.07,0,0,1-13.65,16.4,15.26,15.26,0,0,1-16.79-13.29h0A154,154,0,0,0,340.43,265c-18.64-32.89-47-49.61-84.51-49.61-32.4,0-57.75,9.75-75.19,29-25.14,27.75-30,70.5-26.55,98.78,6.93,48.22,25.46,86.58,58.18,120.86a14.7,14.7,0,0,1-.76,21.11A15.44,15.44,0,0,1,201.31,489.14Z"
const FP_CENTER_WHORL = "M320.49,496a15.31,15.31,0,0,1-3.79-.43c-92.85-23-127.52-115.82-128.93-119.68l-.22-.85c-.76-2.68-19.39-66.33,9.21-103.61,13.11-17,33.05-25.72,59.38-25.72,24.48,0,42.14,7.61,54.28,23.36,10,12.86,14,28.72,17.87,44,8.13,31.82,14,48.53,47.79,50.25,14.84.75,24.59-7.93,30.12-15.32,14.95-20.15,17.55-53,6.28-82C398,228.57,346.61,158,256,158c-38.68,0-74.22,12.43-102.72,35.79C129.69,213.14,111,240.46,102,268.54c-16.69,52.28,5.2,134.46,5.41,135.21A14.83,14.83,0,0,1,96.54,422a15.39,15.39,0,0,1-18.74-10.6c-1-3.75-24.38-91.4-5.1-151.82,21-65.47,85.81-131.47,183.33-131.47,45.07,0,87.65,15.32,123.19,44.25,27.52,22.5,50,52.72,61.76,82.93,14.95,38.57,10.94,81.86-10.19,110.14-14.08,18.86-34.13,28.72-56.34,27.65-57.86-2.9-68.26-43.29-75.84-72.75-7.8-30.22-12.79-44.79-42.58-44.79-16.36,0-27.85,4.5-35,13.82-9.75,12.75-10.51,32.68-9.43,47.14a152.44,152.44,0,0,0,5.1,29.79c2.38,6,33.37,82,107.59,100.39a14.88,14.88,0,0,1,11,18.11A15.36,15.36,0,0,1,320.49,496Z"

/**
 * Biometric thumbprint icon for Check in tab.
 * When clicked, a rotating light wave sweeps directly across the individual
 * thumb lines (from top -> upper -> right hook -> center whorl -> left loop),
 * followed by an electric biometric pulse across all lines.
 * Completely rock-solid with zero shaking or translational movement.
 */
function BiometricPunchIcon({
  active,
  anim,
  color,
}: {
  active: boolean
  anim: Animated.Value
  color: string
}) {
  const styles = useStyles(makeStyles)
  const size = scale(22)

  // Rotating light wave sequence strictly on the thumb lines:
  // 1. Top ridge (0.0 -> 0.22)
  const topGlow = anim.interpolate({
    inputRange: [0, 0.08, 0.22, 0.45, 0.72, 0.88, 1],
    outputRange: [0, 1, 0.15, 0, 0.9, 0.2, 0],
  })

  // 2. Upper-middle ridge (0.12 -> 0.35)
  const upperGlow = anim.interpolate({
    inputRange: [0, 0.12, 0.26, 0.48, 0.74, 0.88, 1],
    outputRange: [0, 0.1, 1, 0.15, 0.85, 0.2, 0],
  })

  // 3. Lower-right hook ridge (0.22 -> 0.45)
  const rightGlow = anim.interpolate({
    inputRange: [0, 0.22, 0.38, 0.58, 0.76, 0.88, 1],
    outputRange: [0, 0.1, 1, 0.15, 0.85, 0.2, 0],
  })

  // 4. Center whorl ridge (0.32 -> 0.55)
  const centerGlow = anim.interpolate({
    inputRange: [0, 0.32, 0.48, 0.65, 0.78, 0.88, 1],
    outputRange: [0, 0.1, 1, 0.2, 0.95, 0.2, 0],
  })

  // 5. Left loop ridge (0.44 -> 0.68)
  const leftGlow = anim.interpolate({
    inputRange: [0, 0.44, 0.58, 0.72, 0.8, 0.88, 1],
    outputRange: [0, 0.1, 1, 0.25, 0.85, 0.2, 0],
  })

  const glowColor = "#10b981" // vibrant electric biometric emerald

  return (
    <View style={styles.punchBox} pointerEvents="none">
      {/* 1. Base fingerprint: all 5 lines in normal tab color */}
      <Svg width={size} height={size} viewBox="0 0 512 512">
        <Path d={FP_TOP} fill={color} />
        <Path d={FP_UPPER} fill={color} />
        <Path d={FP_CENTER_WHORL} fill={color} />
        <Path d={FP_LEFT_LOOP} fill={color} />
        <Path d={FP_RIGHT_HOOK} fill={color} />
      </Svg>

      {/* 2. Top Line Light Glow */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.centreBox, { opacity: topGlow }]}>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Path d={FP_TOP} fill={glowColor} />
        </Svg>
      </Animated.View>

      {/* 3. Upper-Middle Line Light Glow */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.centreBox, { opacity: upperGlow }]}>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Path d={FP_UPPER} fill={glowColor} />
        </Svg>
      </Animated.View>

      {/* 4. Right Hook Line Light Glow */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.centreBox, { opacity: rightGlow }]}>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Path d={FP_RIGHT_HOOK} fill={glowColor} />
        </Svg>
      </Animated.View>

      {/* 5. Center Whorl Line Light Glow */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.centreBox, { opacity: centerGlow }]}>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Path d={FP_CENTER_WHORL} fill={glowColor} />
        </Svg>
      </Animated.View>

      {/* 6. Left Loop Line Light Glow */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.centreBox, { opacity: leftGlow }]}>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Path d={FP_LEFT_LOOP} fill={glowColor} />
        </Svg>
      </Animated.View>
    </View>
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
  iconBox: {
    width: scale(32),
    height: scale(26),
    alignItems: "center",
    justifyContent: "center",
  },
  punchBox: {
    width: scale(32),
    height: scale(26),
    alignItems: "center",
    justifyContent: "center",
  },
  centreBox: {
    alignItems: "center",
    justifyContent: "center",
  },
  moduleGridBox: {
    width: scale(20),
    height: scale(20),
    position: "relative",
  },
  moduleDot: {
    position: "absolute",
    width: scale(6.5),
    height: scale(6.5),
    borderRadius: scale(2.2),
  },
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

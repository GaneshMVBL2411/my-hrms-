import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, BackHandler, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WebView } from "react-native-webview"
import Constants from "expo-constants"
import { getToken } from "./api"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette, type ThemeMode } from "./theme"

/**
 * react-native-webview 13.15.0 — the release SDK 54 pins — declares its props in a
 * way React 19's JSX types collapse to `never`, so every prop below is reported
 * as unassignable. The component itself is fine; only the declaration is behind.
 *
 * Aliased once here rather than casting at the call site, so the JSX stays
 * readable and there is exactly one place to delete when the library catches up.
 */
const Web = WebView as unknown as React.ComponentType<Record<string, unknown>>

/**
 * The rest of the HRMS — dashboard, employees, leaves, projects, tasks,
 * payroll, reports — served from the same portal the browser uses.
 *
 * Rebuilding forty screens in React Native to look at them on a phone would be
 * a great deal of work to arrive exactly where the web app already is. The web
 * app is responsive and installs as a PWA, so what the native shell usefully
 * adds is the hardware sensor at the moment attendance is recorded — which is
 * the other tab, written natively. This one is the portal itself.
 *
 * The one thing worth doing properly here is the session. Signing in natively
 * and then being asked to sign in again inside the WebView would be absurd, so
 * the token from the native login is written into the page's localStorage under
 * the key the web app reads (`hrms_token`, see frontend/src/lib/supabase.ts)
 * before the first line of app code runs.
 */
const PORTAL_URL: string = (
  (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:3001/api"
).replace(/\/api\/?$/, "")

/**
 * Tells the portal which theme the app is in.
 *
 * The web app stores its choice under next-themes' default key, so writing that
 * key is enough for the next load. The synthetic storage event is what makes it
 * apply *now*: next-themes listens for `storage` so a change in one tab reaches
 * the others, and the same listener serves just as well for a change that came
 * from outside the page altogether.
 *
 * "system" is passed through rather than resolved, because the WebView reads
 * the same `prefers-color-scheme` the native side does — sending "dark" would
 * pin the portal to dark for someone who asked only to follow their phone.
 */
function themeScript(mode: ThemeMode): string {
  return `
    (function () {
      try {
        var theme = ${JSON.stringify(mode)};
        window.localStorage.setItem('theme', theme);
        window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: theme }));
      } catch (e) {}
    })();
  `
}

export function PortalScreen({ active, userId }: { active: boolean; userId: number }) {
  const { colors, mode } = useTheme()
  const styles = useStyles(makeStyles)
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const webRef = useRef<WebView | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const insets = useSafeAreaInsets()

  /**
   * Back goes back *inside* the portal, which is what someone three screens
   * into a form expects it to do.
   *
   * Without this the shell's fallback caught the press and jumped to Home, so
   * the only way out of a task form was to lose it. The WebView holds its own
   * history; this hands the press to it for as long as there is somewhere to
   * go, and lets it fall through to the shell once the portal is back at its
   * first page — so a second press still leaves the tab.
   */
  useEffect(() => {
    if (!active || !canGoBack) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      webRef.current?.goBack()
      return true
    })
    return () => sub.remove()
  }, [active, canGoBack])

  useEffect(() => {
    // Re-read on every account change. Read once, this held the token of
    // whoever signed in first — on a shared phone that is a different person
    // from the one now looking at the screen.
    setToken(undefined)
    getToken().then(setToken)
  }, [userId])

  // Keeps the portal in step with the app's theme while it is open. The
  // injection below only runs on load, so without this, switching to dark on
  // the Profile screen would leave the tab someone switches back to still lit.
  //
  // It has to sit up here with the other hooks, above the early returns: this
  // screen returns a spinner until the token resolves, and a hook placed after
  // that return runs on some renders and not others — which is exactly the
  // "rendered more hooks than during the previous render" crash.
  useEffect(() => {
    // Null on the first pass, when the WebView has not mounted yet. That case
    // is already covered by injectedJavaScriptBeforeContentLoaded.
    webRef.current?.injectJavaScript(`${themeScript(mode)} true;`)
  }, [mode])

  if (token === undefined) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  // Runs before the bundle evaluates, so the app's first read of the token
  // already finds it and the portal opens signed in. The `true;` at the end is
  // required by react-native-webview: without it the injection can warn on iOS.
  /**
   * Hands the WebView this session, and clears the last one first.
   *
   * The WebView keeps its own localStorage, and it outlives a sign-out — so
   * everything the portal had cached for the previous person was still sitting
   * there when the next person signed in. Overwriting the token was not enough:
   * anything else the app had stored under that session stayed behind it.
   *
   * Cleared only when the token actually differs, so someone reopening their
   * own portal keeps their place instead of being reset every time.
   */
  const injectSession = `
    (function () {
      try {
        var next = ${JSON.stringify(token ?? "")};
        if (window.localStorage.getItem('hrms_token') !== next) {
          window.localStorage.clear();
        }
        window.localStorage.setItem('hrms_token', next);
        window.localStorage.setItem('hrms_remember_me', 'true');
      } catch (e) {}
    })();
    ${themeScript(mode)}
    true;
  `

  if (failed) {
    return (
      <View style={[styles.centre, { paddingTop: insets.top }]}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.error}>Could not reach the portal.</Text>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.hint}>{PORTAL_URL}</Text>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.hint}>
          Check the tunnel is up and that apiUrl in app.json points at it.
        </Text>
        <TouchableOpacity
          style={styles.retry}
          onPress={() => {
            setFailed(false)
            webRef.current?.reload()
          }}
        >
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Web
        ref={webRef}
        style={styles.web}
        source={{ uri: PORTAL_URL, headers: { "ngrok-skip-browser-warning": "1" } }}
        /**
         * The reason the portal rendered blank.
         *
         * Free ngrok puts an interstitial in front of anything that looks like a
         * browser. `source.headers` only covers the first request, so the HTML
         * arrived fine and then every module the SPA imported came back as the
         * interstitial page instead of JavaScript — the app never booted, and a
         * WebView showing a page that ran no code is simply white.
         *
         * ngrok decides by user agent, and the userAgent prop applies to every
         * request this WebView makes rather than just the document. Verified:
         * with this string the page and /@vite/client both return real content;
         * with a browser UA both return the interstitial.
         */
        userAgent="HRMSMobile/1.0"
        injectedJavaScriptBeforeContentLoaded={injectSession}
        onNavigationStateChange={(nav: { canGoBack: boolean }) => setCanGoBack(nav.canGoBack)}
        onError={() => setFailed(true)}
        onHttpError={(e: { nativeEvent: { url: string } }) => {
          // 4xx on a sub-resource is normal and not worth a full-screen error;
          // only a failed main document means the portal did not load.
          if (e.nativeEvent.url === PORTAL_URL) setFailed(true)
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}
        // The portal handles its own scrolling and pull-to-refresh would fight
        // the routed pages inside it.
        allowsBackForwardNavigationGestures
        originWhitelist={["https://*", "http://*"]}
        javaScriptEnabled
        domStorageEnabled
        // Lets the payslip and letter screens open their print/download views.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  )
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Explicit, because a WebView with no size collapses to nothing and looks
  // exactly like a page that failed to load.
  web: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: scale(20), gap: scale(6), backgroundColor: colors.bg },
  error: { fontSize: scale(15), fontWeight: "600", color: colors.text },
  hint: { fontSize: scale(12), color: colors.muted, textAlign: "center" },
  retry: {
    marginTop: scale(10),
    backgroundColor: colors.brand,
    borderRadius: scale(10),
    paddingHorizontal: scale(18),
    paddingVertical: scale(12), minHeight: scale(44), justifyContent: "center",
  },
  retryText: { color: colors.onFill, fontWeight: "600", fontSize: scale(14) },
})

/**
 * Whether this page is running inside the native app rather than a browser.
 *
 * The mobile app shows the portal in a WebView and sets a user agent of its
 * own — see `userAgent="HRMSMobile/1.0"` in mobile/src/PortalScreen.tsx, which
 * exists for an unrelated reason: ngrok serves an interstitial to anything that
 * looks like a browser, and every module the SPA imported was coming back as
 * that page instead of JavaScript.
 *
 * Reading it here is a second use of the same signal, not a new mechanism. The
 * one thing to know is that the two are now coupled: change that string and
 * this stops recognising the app, so it is named here rather than spelled out
 * at each call site.
 *
 * User agents are trivially spoofed, which is fine — nothing here decides
 * access. It decides whether to show a control that something else already
 * controls, and the worst a forged agent achieves is hiding it from itself.
 */
const NATIVE_SHELL_AGENT = "HRMSMobile"

export function isNativeShell(): boolean {
  if (typeof navigator === "undefined") return false
  return navigator.userAgent.includes(NATIVE_SHELL_AGENT)
}

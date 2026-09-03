import { Dimensions, PixelRatio, Platform, StatusBar } from "react-native"

/**
 * Sizing that holds up across the range of phones this will actually run on.
 *
 * Two separate problems, which look identical on screen and have different fixes:
 *
 *   screen size   a 5" phone and a 7" one differ by about 40% in width, and a
 *                 layout tuned for one is cramped or sparse on the other.
 *                 `scale()` sizes relative to a 375pt baseline — the width of
 *                 the phone most designs are drawn against.
 *
 *   font setting  Android and iOS both let people enlarge system text, and
 *                 React Native multiplies every fontSize by that factor. A
 *                 phone set to "large" renders a 24pt title at 33pt, which is
 *                 what makes a correct layout look wildly oversized. The fix is
 *                 not to ignore the setting — someone chose it and it should
 *                 still do something — but to cap how far it goes, via
 *                 FONT_SCALE_CAP on every Text.
 *
 * Both are needed. Fixing only the first leaves the app broken for anyone with
 * large text; fixing only the second leaves it wrong on small phones.
 */

const BASELINE_WIDTH = 375

/**
 * Sizes a value for this screen.
 *
 * Clamped at both ends deliberately: below 320 the result is unreadable, and
 * above 480 — tablets, foldables — everything would simply inflate rather than
 * getting the extra room it should. Past that width the layout should breathe,
 * not zoom.
 */
export function scale(size: number): number {
  const width = Dimensions.get("window").width
  const clamped = Math.min(Math.max(width, 320), 480)
  return Math.round(PixelRatio.roundToNearestPixel((clamped / BASELINE_WIDTH) * size))
}

/**
 * How far the system font setting may enlarge our text.
 *
 * 1.25 keeps the intent of someone's accessibility choice while stopping a
 * two-line button label from becoming four lines and pushing the buttons below
 * the fold. Passed as `maxFontSizeMultiplier` rather than `allowFontScaling`,
 * because switching scaling off entirely ignores the setting outright.
 */
export const FONT_SCALE_CAP = 1.25

/**
 * The Android status bar height.
 *
 * React Native's own SafeAreaView is iOS-only — on Android it renders as a
 * plain View and contributes nothing, which is why the title sat under the
 * clock. Screens use the insets from react-native-safe-area-context instead;
 * this is the fallback for the rare case that provider is not above them.
 */
export const ANDROID_STATUS_BAR = Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 0

export const colors = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  brand: "#0f4c34",
  danger: "#b91c1c",
  warn: "#b45309",
}

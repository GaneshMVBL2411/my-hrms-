import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { Appearance, useColorScheme } from "react-native"
import * as SecureStore from "expo-secure-store"

/**
 * Light and dark, and the choice between them.
 *
 * Three modes rather than two, because "dark" and "follow the phone" are
 * different requests: someone who sets their phone to switch at sunset expects
 * this app to switch with it, and someone who wants it dark all day expects it
 * to stay dark when the phone does not. "system" is the default, so a fresh
 * install already matches the rest of the handset.
 *
 * The palette is a value passed into the stylesheet rather than a module-level
 * constant, because `StyleSheet.create` runs once at import: a screen that
 * closes over `colors` directly is painted in whichever theme was active when
 * its file was first loaded, and never repaints. Every screen therefore builds
 * its styles through `useStyles(makeStyles)`, which rebuilds them when — and
 * only when — the palette actually changes.
 */

export type Palette = typeof lightColors

export type ThemeMode = "light" | "dark" | "system"

/** Where the choice is kept, so it survives a restart. */
const MODE_KEY = "hrms.theme.mode"

export const lightColors = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  /**
   * The quietest text that is still text: timestamps, placeholders, the label
   * of an unselected tab.
   *
   * Darker than the slate-400 it started as, which measured 2.56:1 against a
   * white bubble — under the 3:1 that non-body text needs, and the reason the
   * time under each message was hard to read in daylight.
   */
  faint: "#7b8a9e",

  /**
   * Two greens, not one. `brand` is a fill with white text on it; `accent` is
   * the same idea drawn *on* a surface — an active tab, a link, a spinner.
   * In light mode they coincide. In dark mode they cannot: a green dark enough
   * to carry white text is nearly invisible as an icon on a near-black
   * background, and a green bright enough to read as an icon cannot carry
   * white text.
   */
  brand: "#0f4c34",
  accent: "#0f4c34",
  /** Text and icons drawn on `brand`, `dangerFill` and other solid fills. */
  onFill: "#ffffff",

  danger: "#b91c1c",
  /** A solid red — the unread badge — as opposed to red text on a surface. */
  dangerFill: "#dc2626",
  warn: "#b45309",

  /**
   * Marks drawn *on* a brand fill, where neither palette's own colours work.
   *
   * `accent` cannot be used here: in light mode it is the same green as the
   * fill, so a read receipt drawn in it was invisible — the bubble's own
   * colour on the bubble. These three are chosen against the fill instead of
   * against the page, which is why they do not change between themes: the
   * surface behind them is the same green in both.
   */
  onFillMuted: "rgba(255,255,255,0.78)",
  tickRead: "#8ed8ff",
  tickFailed: "#ffb4a8",

  /** The quiet inset panel: help text, empty states, a neutral status pill. */
  subtle: "#eef2f7",
  subtleText: "#475569",

  successBg: "#dcfce7",
  successText: "#166534",
  warningBg: "#fef3c7",
  warningText: "#92400e",
  dangerBg: "#fee2e2",
  dangerText: "#991b1b",
}

/**
 * Dark is a re-mix, not an inversion.
 *
 * The surfaces are the same near-navy the web portal uses, so someone moving
 * between the two does not meet a different product. The status pills keep
 * their hue and swap roles: the light fill becomes a dim tint of the same
 * colour and the dark text becomes a bright one, which keeps "approved" green
 * and "rejected" red while staying readable on a dark card.
 */
export const darkColors: Palette = {
  bg: "#0b1220",
  card: "#111a2c",
  border: "#1e293b",
  text: "#f1f5f9",
  muted: "#94a3b8",
  faint: "#64748b",

  brand: "#15795a",
  accent: "#4ade80",
  onFill: "#ffffff",

  danger: "#f87171",
  dangerFill: "#dc2626",
  warn: "#fbbf24",

  onFillMuted: "rgba(255,255,255,0.78)",
  tickRead: "#8ed8ff",
  tickFailed: "#ffb4a8",

  subtle: "#16213a",
  subtleText: "#cbd5e1",

  successBg: "#0f3d28",
  successText: "#86efac",
  warningBg: "#42320c",
  warningText: "#fcd34d",
  dangerBg: "#4a1618",
  dangerText: "#fca5a5",
}

interface ThemeValue {
  /** What was chosen: an explicit theme, or "system" to follow the phone. */
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** What that resolves to right now. */
  scheme: "light" | "dark"
  isDark: boolean
  colors: Palette
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts on "system" and is corrected once the stored choice loads. The read
  // is a single small value and resolves within the splash screen, so nobody
  // sees the app change theme under them.
  const [mode, setModeState] = useState<ThemeMode>("system")
  const system = useColorScheme()

  useEffect(() => {
    SecureStore.getItemAsync(MODE_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") setModeState(stored)
      })
      .catch(() => undefined)
  }, [])

  // Pushes the choice down to the platform as well as up to our own screens.
  // Alerts, the keyboard and the text-selection handles are drawn by the OS and
  // never see our palette — without this, someone running the app dark on a
  // light phone gets a white alert over a dark screen.
  //
  // "unspecified" is what hands the decision back to the phone. React Native
  // renamed this value: it was null up to 0.81 and "unspecified" from 0.82, so
  // this line is the one to check first after an SDK bump.
  useEffect(() => {
    Appearance.setColorScheme(mode === "system" ? "unspecified" : mode)
  }, [mode])

  const setMode = useCallback((next: ThemeMode) => {
    // Applied immediately and stored in the background: the tap should repaint
    // the screen now, and a failed write is not worth blocking that for.
    setModeState(next)
    SecureStore.setItemAsync(MODE_KEY, next).catch(() => undefined)
  }, [])

  const value = useMemo<ThemeValue>(() => {
    const scheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode
    return {
      mode,
      setMode,
      scheme,
      isDark: scheme === "dark",
      colors: scheme === "dark" ? darkColors : lightColors,
    }
  }, [mode, setMode, system])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (value === null) throw new Error("useTheme must be used inside <ThemeProvider>")
  return value
}

/**
 * A screen's stylesheet for the current palette.
 *
 * The factory is called once per palette rather than once per render — both
 * palettes are module constants, so the identity check holds and a screen that
 * re-renders for its own reasons reuses the stylesheet it already had.
 */
export function useStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme()
  return useMemo(() => factory(colors), [factory, colors])
}

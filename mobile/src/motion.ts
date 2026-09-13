import { Animated, Easing } from "react-native"

/**
 * A movement per module, matched to the thing the icon depicts.
 *
 * These are font glyphs, not drawings, so unlike the web sidebar there is no
 * way to move a clock's hands independently of its case — the whole glyph is
 * the only thing that can be transformed. So each motion is chosen to be
 * truthful about the *object* at that limitation: a plane leaves and comes
 * back, a laptop lid folds to its hinge, a megaphone recoils. A clock gets a
 * full sweep, which is the one case where turning the whole glyph is what the
 * real thing does anyway.
 *
 * All are transform-only and run on the native driver, so a tap animates on the
 * UI thread while JavaScript is busy fetching the list underneath.
 */
export type MotionName =
  | "bob" // people shift their weight
  | "tick" // a checkmark lands
  | "fly" // a plane leaves, and returns
  | "open" // a wallet or folder opens
  | "sweep" // a clock hand goes round
  | "lid" // a laptop lid folds to its hinge
  | "flip" // a page turns
  | "riffle" // calendar sheets
  | "shout" // a megaphone recoils
  | "task_open"
  | "leave_open"
  | "payslip_open"
  | "project_open"
  | "calendar_flip"
  | "megaphone_shout"
  | "people_bounce"
  | "clock_tick"
  | "network_expand"
  | "laptop_open"
  | "policy_scroll"
  | "ribbon_stamp"

/** How long each takes, so the grid can wait before navigating away. */
export const MOTION_MS: Record<MotionName, number> = {
  bob: 420,
  tick: 380,
  fly: 620,
  open: 460,
  sweep: 700,
  lid: 520,
  flip: 640,
  riffle: 560,
  shout: 520,
  task_open: 380,
  leave_open: 620,
  payslip_open: 460,
  project_open: 460,
  calendar_flip: 560,
  megaphone_shout: 520,
  people_bounce: 420,
  clock_tick: 700,
  network_expand: 420,
  laptop_open: 520,
  policy_scroll: 640,
  ribbon_stamp: 380,
}

/** Drives one tile's value from 0 to 1 and back where the motion returns. */
export function play(name: MotionName, value: Animated.Value): Animated.CompositeAnimation {
  const up = (duration: number, easing = Easing.out(Easing.quad)) =>
    Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true })
  const down = (duration: number, easing = Easing.in(Easing.quad)) =>
    Animated.timing(value, { toValue: 0, duration, easing, useNativeDriver: true })

  switch (name) {
    // One turn, then stop where it started — a hand sweeping, not a spin.
    case "sweep":
    case "clock_tick":
      return Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: MOTION_MS.sweep,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        // Reset without animating: at a full turn the glyph is back where it
        // started, so snapping to 0 is invisible and leaves the value reusable.
        Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    case "flip":
    case "policy_scroll":
    case "riffle":
    case "calendar_flip":
      return Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: MOTION_MS[name] || 560,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    // A plane accelerates away and eases back; a spring would look like elastic.
    case "fly":
    case "leave_open":
      return Animated.sequence([
        up((MOTION_MS[name] || 620) * 0.55, Easing.in(Easing.cubic)),
        down((MOTION_MS[name] || 620) * 0.45),
      ])
    default:
      return Animated.sequence([
        up((MOTION_MS[name] || 420) * 0.45),
        down((MOTION_MS[name] || 420) * 0.55),
      ])
  }
}

/** The transform for a motion at its current progress. */
export function transformFor(name: MotionName, v: Animated.Value) {
  const to = (outputRange: (string | number)[]) =>
    v.interpolate({ inputRange: [0, 1], outputRange: outputRange as number[] })
  const deg = (outputRange: string[]) => v.interpolate({ inputRange: [0, 1], outputRange })

  switch (name) {
    case "bob":
    case "people_bounce":
    case "network_expand":
      return [{ translateY: to([0, -7]) }]
    case "tick":
    case "task_open":
    case "ribbon_stamp":
      return [{ scale: to([1, 1.35]) }]
    // Away up and to the right, shrinking slightly with distance.
    case "fly":
    case "leave_open":
      return [{ translateX: to([0, 16]) }, { translateY: to([0, -14]) }, { scale: to([1, 0.82]) }]
    // Narrowing on one axis reads as a lid or a flap turning away from you.
    case "open":
    case "payslip_open":
    case "project_open":
      return [{ scaleX: to([1, 0.55]) }, { translateY: to([0, -3]) }]
    case "sweep":
    case "clock_tick":
      return [{ rotate: deg(["0deg", "360deg"]) }]
    // Collapses toward its own base, the way a lid closes onto a keyboard.
    case "lid":
    case "laptop_open":
      return [{ scaleY: to([1, 0.25]) }, { translateY: to([0, 6]) }]
    case "flip":
    case "policy_scroll":
      return [{ rotateY: deg(["0deg", "180deg"]) }]
    case "riffle":
    case "calendar_flip":
      return [{ scaleY: to([1, -1]) }]
    // Back and away from the mouth, which is where the sound goes.
    case "shout":
    case "megaphone_shout":
      return [{ rotate: deg(["0deg", "-14deg"]) }, { translateX: to([0, -4]) }]
    default:
      return []
  }
}

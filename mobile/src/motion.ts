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
  | "bob"     // people shift their weight
  | "tick"    // a checkmark lands
  | "fly"     // a plane leaves, and returns
  | "open"    // a wallet or folder opens
  | "sweep"   // a clock hand goes round
  | "lid"     // a laptop lid folds to its hinge
  | "flip"    // a page turns
  | "riffle"  // calendar sheets
  | "shout"   // a megaphone recoils

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
    case "riffle":
      return Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: MOTION_MS[name],
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    // A plane accelerates away and eases back; a spring would look like elastic.
    case "fly":
      return Animated.sequence([up(MOTION_MS.fly * 0.55, Easing.in(Easing.cubic)), down(MOTION_MS.fly * 0.45)])
    default:
      return Animated.sequence([up(MOTION_MS[name] * 0.45), down(MOTION_MS[name] * 0.55)])
  }
}

/** The transform for a motion at its current progress. */
export function transformFor(name: MotionName, v: Animated.Value) {
  const to = (outputRange: (string | number)[]) =>
    v.interpolate({ inputRange: [0, 1], outputRange: outputRange as number[] })
  const deg = (outputRange: string[]) => v.interpolate({ inputRange: [0, 1], outputRange })

  switch (name) {
    case "bob":
      return [{ translateY: to([0, -7]) }]
    case "tick":
      return [{ scale: to([1, 1.35]) }]
    // Away up and to the right, shrinking slightly with distance.
    case "fly":
      return [{ translateX: to([0, 16]) }, { translateY: to([0, -14]) }, { scale: to([1, 0.82]) }]
    // Narrowing on one axis reads as a lid or a flap turning away from you.
    case "open":
      return [{ scaleX: to([1, 0.55]) }, { translateY: to([0, -3]) }]
    case "sweep":
      return [{ rotate: deg(["0deg", "360deg"]) }]
    // Collapses toward its own base, the way a lid closes onto a keyboard.
    case "lid":
      return [{ scaleY: to([1, 0.25]) }, { translateY: to([0, 6]) }]
    case "flip":
      return [{ rotateY: deg(["0deg", "180deg"]) }]
    case "riffle":
      return [{ scaleY: to([1, -1]) }]
    // Back and away from the mouth, which is where the sound goes.
    case "shout":
      return [{ rotate: deg(["0deg", "-14deg"]) }, { translateX: to([0, -4]) }]
    default:
      return []
  }
}

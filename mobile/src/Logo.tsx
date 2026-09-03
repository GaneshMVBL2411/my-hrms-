import { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { scale } from "./ui"

const AnimatedPath = Animated.createAnimatedComponent(Path)

/** The W the light runs, drawn wider than the mark so it passes outside it. */
const W_PATH = "M6 26 L28 80 L50 40 L72 80 L94 26"

/**
 * The Whhoohh Path mark, moving the way a hung object moves, with a light
 * running a W around it.
 *
 * Four motions, in the order the physics would produce them:
 *
 *   drop    it arrives from above and is caught, overshooting slightly and
 *           settling — a spring with real damping rather than the rubbery
 *           default, which reads as a bouncing ball instead of a solid emblem
 *   float   once settled it rises and falls a few pixels, as something hanging
 *           on a line does
 *   sway    and rotates a degree or so either way
 *   trace   a short bright dash travels the W, along a faint track of the same
 *           path. The track matters: without it the dash reads as a stray
 *           streak across the logo instead of light moving down something.
 *
 * The float and the sway run on deliberately mismatched periods — 2.6s and
 * 4.1s. Matched, they would peak together and the loop would be obvious after
 * two cycles; offset, they drift in and out of phase and the motion never quite
 * repeats, which is what stops it looking mechanical.
 *
 * The three transforms are driven natively and run on the UI thread. The trace
 * cannot be: it animates strokeDashoffset, which is a plain SVG property
 * rather than a transform or opacity, and the native driver takes only those.
 * It is one interpolated number per frame, which the JS thread carries without
 * trouble — but it is the reason the trace is the first thing to stutter if
 * something else blocks that thread.
 */
export function Logo({ size = 96, animate = true }: { size?: number; animate?: boolean }) {
  const drop = useRef(new Animated.Value(0)).current
  const float = useRef(new Animated.Value(0)).current
  const sway = useRef(new Animated.Value(0)).current
  const trace = useRef(new Animated.Value(0)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    // Someone who has asked their phone to cut animation should not be given a
    // swinging logo. The mark still appears — it simply arrives already settled.
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!animate || reduceMotion) {
      drop.setValue(1)
      return
    }

    Animated.spring(drop, {
      toValue: 1,
      // Damping high enough that it settles in one overshoot. The default
      // spring wobbles several times, which suits a toy and not a logo.
      damping: 12,
      stiffness: 140,
      mass: 1,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return

      // Only once it has come to rest — starting the idle loops during the drop
      // would fight the spring and leave the mark visibly off-centre.
      const breathe = (value: Animated.Value, duration: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: 1,
              duration,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        ).start()

      breathe(float, 2600)
      breathe(sway, 4100)

      // Linear, because light travelling a tube does not ease, and one-way
      // rather than a sequence — the dash leaves the end of the path and
      // re-enters at the start, so there is nothing to come back from.
      Animated.loop(
        Animated.timing(trace, {
          toValue: 1,
          duration: 3400,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      ).start()
    })
  }, [animate, reduceMotion, drop, float, sway, trace])

  const px = scale(size)
  // The W is drawn outside the mark, so its box is larger on every side.
  const traceSize = Math.round(px * 1.52)

  return (
    <View style={[styles.wrap, { width: px, height: px }]}>
      {animate && !reduceMotion && (
        <Svg
          pointerEvents="none"
          style={[styles.trace, { width: traceSize, height: traceSize }]}
          viewBox="0 0 100 100"
        >
          {/* the tube */}
          <Path d={W_PATH} stroke="#d9b45f" strokeOpacity={0.3} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {/* the light: one lit segment, one long gap, slid around the path */}
          <AnimatedPath
            d={W_PATH}
            stroke="#f0d493"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            // The path is 207.92 user units long (58.31 + 45.65 + 45.65 + 58.31),
            // computed rather than guessed: 20 + 188 tiles it exactly once, so the
            // light leaves the end just as it re-enters the start and the loop has
            // no visible jump. Expressed in user units because react-native-svg has
            // no pathLength to normalise against, the way SVG in a browser does.
            strokeDasharray="20 188"
            strokeDashoffset={trace.interpolate({ inputRange: [0, 1], outputRange: [208, 0] })}
          />
        </Svg>
      )}

      <Animated.Image
        source={require("../assets/logo-mark.png")}
        accessibilityLabel="Whhoohh Path"
        resizeMode="contain"
        style={{
          width: px,
          height: px,
          opacity: drop,
          transform: [
            {
              translateY: Animated.add(
                drop.interpolate({ inputRange: [0, 1], outputRange: [-scale(30), 0] }),
                float.interpolate({ inputRange: [0, 1], outputRange: [0, -scale(5)] })
              ),
            },
            { scale: drop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
            { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ["-1.4deg", "1.4deg"] }) },
          ],
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  // Centred on the mark and behind it, overflowing the wrapper on every side.
  trace: { position: "absolute" },
})

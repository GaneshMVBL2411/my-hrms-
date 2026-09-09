import { useEffect, useState } from "react"
import { Keyboard, type KeyboardEvent, Platform } from "react-native"

export interface KeyboardState {
  isKeyboardVisible: boolean
  keyboardHeight: number
  dismiss: () => void
}

/**
 * Robust cross-platform keyboard listener for Android and iOS.
 *
 * Android typically emits `keyboardDidShow` / `keyboardDidHide` while iOS
 * emits `keyboardWillShow` / `keyboardWillHide`. This hook registers listeners
 * for both platforms so that layout transitions (e.g. shrinking the logo,
 * scrolling inputs above the fold, docking chat composer to the keyboard)
 * happen smoothly and synchronously.
 */
export function useKeyboard(): KeyboardState {
  const [isKeyboardVisible, setKeyboardVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"

    const onShow = (e: KeyboardEvent) => {
      setKeyboardVisible(true)
      setKeyboardHeight(e.endCoordinates.height)
    }

    const onHide = () => {
      setKeyboardVisible(false)
      setKeyboardHeight(0)
    }

    const showSub = Keyboard.addListener(showEvent, onShow)
    const hideSub = Keyboard.addListener(hideEvent, onHide)

    // Fallback: Android can occasionally fire keyboardDidShow even on iOS or vice-versa in emulators
    const showDidSub =
      Platform.OS === "ios" ? Keyboard.addListener("keyboardDidShow", onShow) : null
    const hideDidSub =
      Platform.OS === "ios" ? Keyboard.addListener("keyboardDidHide", onHide) : null

    return () => {
      showSub.remove()
      hideSub.remove()
      showDidSub?.remove()
      hideDidSub?.remove()
    }
  }, [])

  return {
    isKeyboardVisible,
    keyboardHeight,
    dismiss: Keyboard.dismiss,
  }
}

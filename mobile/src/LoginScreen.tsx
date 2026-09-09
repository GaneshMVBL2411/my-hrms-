import { useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { login, requestPasswordReset, type SessionUser } from "./api"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"
import { Logo } from "./Logo"
import { useKeyboard } from "./keyboard"

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const { isKeyboardVisible, keyboardHeight } = useKeyboard()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotOpen, setForgotOpen] = useState(false)

  const passwordRef = useRef<TextInput>(null)
  const scrollRef = useRef<ScrollView>(null)
  const insets = useSafeAreaInsets()

  const revealForm = (field: "email" | "password") => {
    setFocusedField(field)
    setTimeout(() => {
      if (field === "password") {
        scrollRef.current?.scrollTo({ y: scale(100), animated: true })
      } else {
        scrollRef.current?.scrollTo({ y: scale(20), animated: true })
      }
    }, 100)
  }

  async function submit() {
    if (!email || !password || busy) return
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await login(email.trim(), password))
    } catch (e) {
      setError((e as Error).message || "Could not sign in")
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          {
            justifyContent: isKeyboardVisible ? "flex-start" : "center",
            paddingTop: isKeyboardVisible ? insets.top + scale(12) : insets.top + scale(40),
            paddingBottom: (isKeyboardVisible ? keyboardHeight : insets.bottom) + scale(24),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.brand, isKeyboardVisible && styles.brandCompact]}>
          <Logo size={isKeyboardVisible ? scale(44) : scale(92)} />
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP}
            style={[styles.title, isKeyboardVisible && styles.titleCompact]}
          >
            Whhoohh Path
          </Text>
          {!isKeyboardVisible && (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.subtitle}>
              Sign in to record your attendance
            </Text>
          )}
        </View>

        <TextInput
          style={[styles.input, focusedField === "email" && styles.inputFocused]}
          placeholder="Email"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          returnKeyType="next"
          onFocus={() => revealForm("email")}
          onBlur={() => setFocusedField(null)}
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          value={email}
          onChangeText={setEmail}
          maxFontSizeMultiplier={FONT_SCALE_CAP}
        />

        <View style={styles.passwordWrap}>
          <TextInput
            ref={passwordRef}
            style={[
              styles.input,
              styles.passwordInput,
              focusedField === "password" && styles.inputFocused,
            ]}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textContentType="password"
            autoComplete="password"
            returnKeyType="go"
            onFocus={() => revealForm("password")}
            onBlur={() => setFocusedField(null)}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            maxFontSizeMultiplier={FONT_SCALE_CAP}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={scale(21)}
              color={colors.muted}
            />
          </TouchableOpacity>
        </View>

        {error && (
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.error}>
            {error}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.button, (busy || !email || !password) && styles.buttonDisabled]}
          onPress={submit}
          disabled={busy || !email || !password}
        >
          {busy ? (
            <ActivityIndicator color={colors.onFill} />
          ) : (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.buttonText}>
              Sign in
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotButton}
          onPress={() => setForgotOpen(true)}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.forgotText}>
            Forgot password?
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {forgotOpen && (
        <ForgotPassword initialEmail={email} onClose={() => setForgotOpen(false)} />
      )}
    </KeyboardAvoidingView>
  )
}

/**
 * Asks for a reset link.
 *
 * It cannot say whether the address exists, so it does not try — the server
 * answers identically either way, on purpose, and a screen that claimed "sent!"
 * would be inventing a confirmation the server deliberately withheld. What it
 * can do is be clear about what happens next, which is that the link arrives by
 * email and is opened there.
 *
 * The reset itself is finished on that link rather than here. The token is
 * emailed and never returned to a client, so an in-app "enter the code" step
 * would need somewhere to get the code from; the link already goes to the
 * portal's reset page, which is one implementation of the form rather than two.
 */
function ForgotPassword({
  initialEmail,
  onClose,
}: {
  initialEmail: string
  onClose: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const address = email.trim()
    if (!address || busy) return
    setBusy(true)
    setError(null)
    try {
      setSent(await requestPasswordReset(address))
    } catch (e) {
      // The only failures that reach here are transport ones — an unreachable
      // server, or the rate limiter — since the endpoint answers 200 for both a
      // known and an unknown address.
      setError((e as Error).message || "Could not reach the server")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.sheet}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetTitle}>
            {sent ? "Check your email" : "Reset your password"}
          </Text>

          {sent ? (
            <>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetBody}>
                {sent}
              </Text>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetHint}>
                Open the link on this phone to choose a new password. It expires in
                30 minutes, and using it signs you out everywhere.
              </Text>
              <TouchableOpacity
                style={[styles.sheetBtn, styles.sheetPrimary, styles.sheetSoleBtn]}
                onPress={onClose}
              >
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetPrimaryText}>
                  Done
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetBody}>
                Enter your work email and we will send you a link to set a new
                password.
              </Text>
              <TextInput
                style={[styles.input, { marginTop: scale(12) }]}
                placeholder="you@whhoohhpath.com"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="send"
                autoFocus
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submit}
                maxFontSizeMultiplier={FONT_SCALE_CAP}
              />
              {error && (
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.error}>
                  {error}
                </Text>
              )}
              <View style={styles.sheetButtons}>
                <TouchableOpacity style={[styles.sheetBtn, styles.sheetGhost]} onPress={onClose}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetGhostText}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetPrimary, (busy || !email.trim()) && styles.buttonDisabled]}
                  disabled={busy || !email.trim()}
                  onPress={submit}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onFill} />
                  ) : (
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetPrimaryText}>
                      Send link
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: scale(20) },
  brand: { alignItems: "center", marginBottom: scale(8) },
  brandCompact: { marginBottom: scale(4) },
  title: { fontSize: scale(24), fontWeight: "700", color: colors.text, marginTop: scale(10) },
  titleCompact: { fontSize: scale(18), marginTop: scale(4) },
  subtitle: { fontSize: scale(13), color: colors.muted, marginTop: scale(4), marginBottom: scale(20), textAlign: "center" },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.2,
    borderColor: colors.border,
    borderRadius: scale(10),
    paddingHorizontal: scale(13),
    paddingVertical: scale(12),
    fontSize: scale(15),
    color: colors.text,
    marginBottom: scale(10),
    minHeight: scale(48),
  },
  inputFocused: {
    borderColor: colors.brand,
    borderWidth: 1.6,
  },
  passwordWrap: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: scale(46) },
  eyeButton: {
    position: "absolute",
    right: scale(13),
    top: 0,
    bottom: scale(10),
    justifyContent: "center",
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: scale(10),
    paddingVertical: scale(14),
    alignItems: "center",
    justifyContent: "center",
    minHeight: scale(48),
    marginTop: scale(6),
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onFill, fontSize: scale(16), fontWeight: "600" },
  error: { color: colors.danger, marginBottom: scale(6), fontSize: scale(13) },

  // ----------------------------------------------------- forgot password
  forgotButton: { alignSelf: "center", marginTop: scale(16), paddingVertical: scale(6) },
  forgotText: { color: colors.accent, fontSize: scale(14), fontWeight: "600" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    padding: scale(20),
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: scale(14),
    padding: scale(18),
  },
  sheetTitle: { fontSize: scale(17), fontWeight: "700", color: colors.text },
  sheetBody: { fontSize: scale(13.5), lineHeight: scale(20), color: colors.muted, marginTop: scale(8) },
  sheetHint: { fontSize: scale(12), lineHeight: scale(18), color: colors.faint, marginTop: scale(10) },
  sheetButtons: { flexDirection: "row", gap: scale(10), marginTop: scale(14) },
  sheetBtn: {
    flex: 1,
    borderRadius: scale(10),
    minHeight: scale(46),
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSoleBtn: { marginTop: scale(16) },
  sheetGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  sheetGhostText: { color: colors.text, fontWeight: "600", fontSize: scale(14) },
  sheetPrimary: { backgroundColor: colors.brand },
  sheetPrimaryText: { color: colors.onFill, fontWeight: "700", fontSize: scale(14) },
})

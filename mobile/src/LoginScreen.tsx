import { useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { login, type SessionUser } from "./api"
import { colors, scale, FONT_SCALE_CAP } from "./ui"
import { Logo } from "./Logo"

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Without this the email field's "next" key has nothing to move to, and the
  // password field can only be reached by tapping it — which is impossible when
  // the keyboard is covering it. Both values then end up in the email box.
  const passwordRef = useRef<TextInput>(null)
  const insets = useSafeAreaInsets()

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
      // Android is handled natively by softwareKeyboardLayoutMode: "pan" in
      // app.json, which slides the window so the focused field stays visible.
      // Adding a behavior here as well makes both adjust and the form jumps.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* A ScrollView so the form is still reachable on a short screen with the
          keyboard up — on a small phone the button would otherwise be under it. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + scale(40), paddingBottom: insets.bottom + scale(24) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Logo size={104} />
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.title}>
            Whhoohh Path
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.subtitle}>
            Sign in to record your attendance
          </Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          returnKeyType="next"
          // blurOnSubmit={false} stops the keyboard closing and reopening as
          // focus moves, which on Android drops the first keystroke.
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          value={email}
          onChangeText={setEmail}
          maxFontSizeMultiplier={FONT_SCALE_CAP}
        />
        {/*
          The reveal toggle is not a convenience here, it is a diagnostic. A
          masked field shows dots whether or not the keyboard capitalised the
          first character, so a password mangled on the way in looks identical
          to a correct one and the only feedback is "Invalid email or password".
          Being able to see what was actually typed is what makes that visible.
        */}
        <View style={styles.passwordWrap}>
          <TextInput
            ref={passwordRef}
            style={[styles.input, styles.passwordInput]}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            secureTextEntry={!showPassword}
            // Android does not infer these from secureTextEntry the way iOS does,
            // so without them Gboard capitalises the first character and the
            // password is silently wrong — a correct password rejected as
            // "Invalid email or password", with nothing on screen to explain it.
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textContentType="password"
            // textContentType is iOS-only; this is the Android half of the pair.
            autoComplete="password"
            returnKeyType="go"
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
            // The icon is small; this widens the touch target to the 44pt
            // minimum without moving anything on screen.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={scale(20)}
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
            <ActivityIndicator color="#fff" />
          ) : (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.buttonText}>
              Sign in
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: "center", padding: scale(20) },
  brand: { alignItems: "center", marginBottom: scale(4) },
  title: { fontSize: scale(24), fontWeight: "700", color: colors.text, marginTop: scale(10) },
  subtitle: { fontSize: scale(13), color: colors.muted, marginTop: scale(4), marginBottom: scale(20), textAlign: "center" },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(10),
    paddingHorizontal: scale(13),
    paddingVertical: scale(13),
    fontSize: scale(15),
    color: colors.text,
    marginBottom: scale(10),
    minHeight: scale(48),
  },
  passwordWrap: { position: "relative", justifyContent: "center" },
  // Keeps the typed password clear of the icon rather than running under it.
  passwordInput: { paddingRight: scale(46) },
  eyeButton: {
    position: "absolute",
    right: scale(13),
    // Offset by the input's own marginBottom so the icon sits on the field's
    // centre line rather than the wrapper's.
    top: 0,
    bottom: scale(10),
    justifyContent: "center",
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: scale(10),
    paddingVertical: scale(15),
    alignItems: "center",
    justifyContent: "center",
    minHeight: scale(48),
    marginTop: scale(6),
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: scale(16), fontWeight: "600" },
  error: { color: colors.danger, marginBottom: scale(6), fontSize: scale(13) },
})

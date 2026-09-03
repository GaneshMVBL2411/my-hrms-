import * as ed from "@noble/ed25519"
import { sha512 } from "@noble/hashes/sha2.js"
import * as SecureStore from "expo-secure-store"
import * as Crypto from "expo-crypto"
import * as LocalAuthentication from "expo-local-authentication"

/**
 * @noble/ed25519 reaches for `crypto.subtle` to hash, and React Native has no
 * WebCrypto — so every call threw "crypto.subtle must be defined" before any of
 * the interesting code ran. That was the setup error.
 *
 * Injecting a pure-JS SHA-512 is the library's documented remedy. Both the sync
 * and async hooks are set because the two entry points used here take different
 * paths to the same hash, and leaving either unset fails only on whichever call
 * happens to run first.
 */
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))
ed.etc.sha512Async = async (...m) => sha512(ed.etc.concatBytes(...m))

/**
 * Device enrolment and the signature that proves a punch.
 *
 * The web app uses WebAuthn, which React Native has no equivalent of, so this
 * rebuilds the property that mattered rather than the API: the server must be
 * able to *verify* that the person holding the phone passed a biometric check,
 * not merely take the app's word for it.
 *
 * `expo-local-authentication` on its own cannot do that. It returns a boolean,
 * and a boolean sent to a server is a claim, not evidence — a patched build
 * could return true forever and every punch would look identical to a real one.
 * That is the entire problem this feature exists to solve, so a boolean is not
 * good enough.
 *
 * What happens instead:
 *
 *   enrol  an ed25519 keypair is generated on the device. The private key goes
 *          into the OS keystore behind `requireAuthentication`, so reading it
 *          costs a Face ID or fingerprint check enforced by the platform, not
 *          by this code. Only the public key is sent to the server.
 *   punch  the server issues a challenge; the app reads the private key (which
 *          triggers the biometric prompt), signs, and returns the signature.
 *          The server verifies against the public key it stored.
 *
 * The server therefore holds nothing secret and nothing biometric — the same
 * two properties WebAuthn gives the web app.
 *
 * The honest limit: on a rooted or jailbroken device the keystore's guarantees
 * weaken, and unlike a WebAuthn authenticator there is no signature counter, so
 * a successfully extracted key would not announce itself. This is strong enough
 * to stop a colleague punching for an absent friend, which is the actual threat;
 * it is not a defence against the phone's owner attacking their own hardware.
 */

/**
 * One key slot per account, not one per phone.
 *
 * A phone gets shared — a demo handset, a device at the desk, two people who
 * both need to punch. A single slot meant the second person to enrol silently
 * overwrote the first, who then came back to find themselves no longer set up.
 * Keying the slot by user id lets several accounts keep their own key on the
 * same device, each unlocked by its own biometric and verified by the server
 * against that user's own registered public key.
 *
 * The server was never at risk here — it checks a punch against the signed-in
 * user's public key, so a mismatched key fails rather than punching for the
 * wrong person. What was wrong was on the phone: it asked whoever was holding
 * it to unlock a key that belonged to someone else.
 */
const keyName = (userId: number) => `hrms.device.privateKey.${userId}`
const gateName = (userId: number) => `hrms.device.gate.${userId}`

/**
 * The single-slot names used before this. Read once so an existing enrolment is
 * carried over instead of being silently dropped, then removed.
 */
const LEGACY_KEY = "hrms.device.privateKey"
const LEGACY_GATE = "hrms.device.gate"
const LEGACY_OWNER = "hrms.device.userId"

/** Whether the phone has a usable sensor and something enrolled in it. */
export async function biometricReady(): Promise<{ ok: boolean; reason?: string }> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  if (!hasHardware) return { ok: false, reason: "This device has no fingerprint or face sensor." }

  const enrolled = await LocalAuthentication.isEnrolledAsync()
  if (!enrolled) {
    return { ok: false, reason: "Set up Face ID, Touch ID or a fingerprint in your phone's settings first." }
  }

  // requireAuthentication on SecureStore needs a device passcode; without one
  // the key would be stored unprotected, which would quietly defeat the point.
  const security = await LocalAuthentication.getEnrolledLevelAsync()
  if (security === LocalAuthentication.SecurityLevel.NONE) {
    return { ok: false, reason: "Set a screen lock on your phone first." }
  }

  return { ok: true }
}

/**
 * Moves a pre-existing single-slot key into its owner's slot, once.
 *
 * Without this, everyone already set up would find themselves un-enrolled after
 * the update. A key whose owner cannot be established is deleted rather than
 * assumed to be the current user's — the cost of that is one re-enrolment,
 * where guessing wrong is the mix-up this whole change exists to prevent.
 */
async function carryOverLegacyKey(userId: number): Promise<void> {
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY, { requireAuthentication: false }).catch(
    () => null
  )
  if (legacy === null) return

  const owner = await SecureStore.getItemAsync(LEGACY_OWNER).catch(() => null)
  if (owner === String(userId)) {
    const gate = await SecureStore.getItemAsync(LEGACY_GATE).catch(() => null)
    await SecureStore.setItemAsync(keyName(userId), legacy).catch(() => undefined)
    await SecureStore.setItemAsync(gateName(userId), gate === "keystore" ? "keystore" : "prompt").catch(
      () => undefined
    )
  }

  await SecureStore.deleteItemAsync(LEGACY_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(LEGACY_GATE).catch(() => undefined)
  await SecureStore.deleteItemAsync(LEGACY_OWNER).catch(() => undefined)
}

/** True once *this user* has a key on this device. */
export async function isEnrolled(userId: number): Promise<boolean> {
  await carryOverLegacyKey(userId)
  // Deliberately does not require authentication: this only asks whether the
  // key exists, and prompting for a fingerprint just to render a button would
  // be indefensible. The prompt belongs at the moment of signing.
  const value = await SecureStore.getItemAsync(keyName(userId), {
    requireAuthentication: false,
  }).catch(() => null)
  return value !== null
}

export async function createDeviceKey(userId: number): Promise<string> {
  const privateKey = Crypto.getRandomBytes(32)
  const publicKey = await ed.getPublicKeyAsync(privateKey)

  try {
    await SecureStore.setItemAsync(keyName(userId), toHex(privateKey), {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: "Confirm it is you to set up check-in",
    })
    await SecureStore.setItemAsync(gateName(userId), "keystore")
  } catch {
    // Expo Go cannot store a key behind the keystore's own biometric gate —
    // that needs a build with the native module configured. Rather than fail
    // setup outright, the key is stored unguarded and the biometric is enforced
    // by an explicit prompt before every signature instead.
    //
    // The difference is real and worth being clear about: with the keystore
    // gate, the OS refuses to hand over the key without a fingerprint. With the
    // prompt, the app asks and then reads the key — a patched build could skip
    // the asking. Good enough to demonstrate and to stop a colleague punching
    // for a friend; not the full guarantee. A dev build restores it, and
    // `gateMode()` reports which one is in force.
    await SecureStore.setItemAsync(keyName(userId), toHex(privateKey))
    await SecureStore.setItemAsync(gateName(userId), "prompt")
  }

  return toHex(publicKey)
}

/** Which of the two gates this user's key ended up behind. */
export async function gateMode(userId: number): Promise<"keystore" | "prompt" | null> {
  const value = await SecureStore.getItemAsync(gateName(userId)).catch(() => null)
  return value === "keystore" || value === "prompt" ? value : null
}

/**
 * Signs a challenge, taking the biometric on the way.
 *
 * Which kind of "on the way" depends on how the key got stored:
 *
 *   keystore  the OS raises the prompt because the key cannot be read without
 *             it. Nothing in this function could be edited to skip it.
 *   prompt    this code asks, then reads the key. Weaker — the asking is a
 *             branch, and a branch can be removed from a patched build.
 *
 * Either way the signature is what the server checks, and without the key there
 * is no signature.
 */
export async function signChallenge(challenge: string, userId: number): Promise<string> {
  const gate = await gateMode(userId)

  if (gate === "prompt") {
    // The key is not keystore-gated on this build, so the biometric has to be
    // demanded here. Checked strictly: anything other than an outright success
    // stops the punch, including a cancel.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirm it is you to record attendance",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    })
    if (!result.success) throw new Error("cancelled")
  }

  const stored = await SecureStore.getItemAsync(
    keyName(userId),
    gate === "keystore"
      ? { requireAuthentication: true, authenticationPrompt: "Confirm it is you to record attendance" }
      : undefined
  )
  if (!stored) throw new Error("This device is not set up for biometric check-in")

  // Encoded by hand rather than with TextEncoder, which is not guaranteed to
  // exist on every React Native engine. The challenge is hex from the server,
  // so it is pure ASCII and a charCode per byte is exactly right — and it must
  // match what the server hashes, byte for byte, or the signature fails.
  const message = Uint8Array.from(challenge, (c) => c.charCodeAt(0) & 0xff)
  const signature = await ed.signAsync(message, fromHex(stored))
  return toHex(signature)
}

/** Removes only this user's key. Anyone else set up on this phone keeps theirs. */
export async function forgetDeviceKey(userId: number): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(userId)).catch(() => undefined)
  await SecureStore.deleteItemAsync(gateName(userId)).catch(() => undefined)
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

const fromHex = (hex: string) =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16)))

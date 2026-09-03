import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import type { PoolClient } from "pg"

/**
 * Biometric attendance: the phone proves who is punching in.
 *
 * The problem this solves is buddy punching. A password can be shared and a
 * shared password is indistinguishable from the real person, so an attendance
 * log built on one records what people typed, not who was there. WebAuthn moves
 * the proof to something that cannot be passed to a colleague: a key held in
 * the phone's secure element, released only when the phone's own Face ID, Touch
 * ID or fingerprint sensor is satisfied.
 *
 * What the server sees, and what it never sees
 *
 * Enrolment stores a public key. Each check-in verifies a signature over a
 * challenge this server generated seconds earlier. No fingerprint, no face, no
 * template of either ever leaves the device — the biometric only unlocks the
 * key locally, and the phone tells us nothing about it beyond "the user was
 * verified". That is the whole reason to prefer this over photographing a face
 * and matching it here: it is strictly stronger evidence, and it leaves us
 * holding nothing that a breach could turn into biometric data.
 *
 * Two properties make the signature meaningful rather than decorative:
 *
 *   * The challenge is generated here, single-use, and expires. A recording of
 *     yesterday's successful check-in replays into a rejection.
 *   * The signature counter must advance. An authenticator that signs with a
 *     counter at or below the stored one is the signature of a cloned
 *     credential, and is refused.
 */

/**
 * The Relying Party ID: the domain the credential is bound to, and the thing
 * that stops a phishing site spending a credential registered here.
 *
 * It must be the site's registered domain with no scheme and no port, and the
 * origin must match in full. Both come from the environment because they differ
 * per deployment, and getting them wrong does not fail loudly at boot — it
 * fails in the browser, at the moment someone tries to enrol.
 *
 * A tunnel with a fresh random hostname on every restart (a Cloudflare quick
 * tunnel) will invalidate every credential enrolled through the previous one:
 * the credential is bound to the origin it was created on and simply will not
 * be offered on a different host. A reserved domain avoids that.
 */
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost"
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "HRMS"
const ORIGINS = (process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim())

/**
 * Challenges, held until they are spent.
 *
 * In memory on purpose: a challenge is worthless within about a minute of being
 * issued, and a restart losing them costs a user one retap. It does mean a
 * multi-instance deployment needs this in Redis or a table instead — with two
 * instances behind a load balancer, the instance that verifies is not
 * necessarily the one that issued, and enrolment fails intermittently in a way
 * that is thoroughly confusing to debug. Single instance today, so: a Map.
 */
const challenges = new Map<string, { challenge: string; expires: number }>()
const CHALLENGE_TTL_MS = 120_000

function putChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expires: Date.now() + CHALLENGE_TTL_MS })
}

/** Reads a challenge and spends it: a second use of the same one finds nothing. */
function takeChallenge(key: string): string | null {
  const entry = challenges.get(key)
  challenges.delete(key)
  if (!entry || entry.expires < Date.now()) return null
  return entry.challenge
}

// Opportunistic sweep, so abandoned ceremonies do not accumulate. Cheap enough
// to run on every issue given how few are ever in flight at once.
function sweepChallenges() {
  const now = Date.now()
  for (const [key, entry] of challenges) if (entry.expires < now) challenges.delete(key)
}

export interface StoredCredential {
  id: number
  credential_id: string
  public_key: Buffer
  counter: string
  transports: string | null
}

// ------------------------------------------------------------- enrolment
/**
 * Offers the browser a registration ceremony.
 *
 * `excludeCredentials` lists what this account has already enrolled, which is
 * what makes the phone say "you have already set this up" instead of silently
 * creating a duplicate credential for the same finger on the same device.
 */
export async function registrationOptions(
  client: PoolClient,
  userId: number,
  email: string
) {
  const { rows } = await client.query<StoredCredential>(
    `select id, credential_id, public_key, counter, transports
       from public.webauthn_credentials where user_id = $1`,
    [userId]
  )

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: email,
    userDisplayName: email,
    // Discourage a second credential for a device already enrolled.
    excludeCredentials: rows.map((r) => ({ id: r.credential_id })),
    authenticatorSelection: {
      // "platform" is the built-in sensor: Face ID, Touch ID, Android
      // biometrics. Not a roaming security key, which an employee could hand to
      // someone else and thereby reintroduce exactly the problem being solved.
      authenticatorAttachment: "platform",
      // The point of the whole exercise: a biometric (or device PIN as the
      // platform's own fallback) must be satisfied, not merely presence.
      userVerification: "required",
      residentKey: "preferred",
    },
    timeout: CHALLENGE_TTL_MS,
  })

  sweepChallenges()
  putChallenge(`reg:${userId}`, options.challenge)
  return options
}

/** Verifies the ceremony and stores the credential. Returns the stored row id. */
export async function verifyRegistration(
  client: PoolClient,
  userId: number,
  companyId: number | null,
  response: unknown,
  deviceLabel: string | null
) {
  const expectedChallenge = takeChallenge(`reg:${userId}`)
  if (!expectedChallenge) throw new WebAuthnError("Registration expired — start again")

  const verification = await verifyRegistrationResponse({
    response: response as never,
    expectedChallenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new WebAuthnError("Could not verify this device")
  }

  const { credential, credentialDeviceType } = verification.registrationInfo

  const { rows } = await client.query<{ id: number }>(
    `insert into public.webauthn_credentials
       (user_id, credential_id, public_key, counter, transports, device_label, company_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      userId,
      credential.id,
      Buffer.from(credential.publicKey),
      String(credential.counter),
      credential.transports?.join(",") ?? null,
      deviceLabel,
      companyId,
    ]
  )

  const stored = rows[0]
  if (!stored) throw new WebAuthnError("Could not save this device")

  return { id: stored.id, deviceType: credentialDeviceType }
}

// --------------------------------------------------------- authentication
/** Offers the browser an authentication ceremony for this account's devices. */
export async function authenticationOptions(client: PoolClient, userId: number) {
  const { rows } = await client.query<StoredCredential>(
    `select id, credential_id, public_key, counter, transports
       from public.webauthn_credentials where user_id = $1`,
    [userId]
  )

  if (rows.length === 0) throw new WebAuthnError("No device enrolled for biometric check-in")

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: rows.map((r) => ({
      id: r.credential_id,
      transports: (r.transports?.split(",") as never) ?? undefined,
    })),
    userVerification: "required",
    timeout: CHALLENGE_TTL_MS,
  })

  sweepChallenges()
  putChallenge(`auth:${userId}`, options.challenge)
  return options
}

/**
 * Verifies an assertion. Returns only when the signature is good, the challenge
 * was the one just issued, and the counter advanced — anything else throws, so
 * a caller cannot mistake a failed check for a passed one.
 */
export async function verifyAuthentication(
  client: PoolClient,
  userId: number,
  response: { id?: string } & Record<string, unknown>
) {
  const expectedChallenge = takeChallenge(`auth:${userId}`)
  if (!expectedChallenge) throw new WebAuthnError("Verification expired — try again")

  const credentialId = typeof response.id === "string" ? response.id : ""
  const { rows } = await client.query<StoredCredential>(
    `select id, credential_id, public_key, counter, transports
       from public.webauthn_credentials where user_id = $1 and credential_id = $2`,
    [userId, credentialId]
  )
  const stored = rows[0]
  // Scoped to user_id as well as credential_id, so a credential belonging to
  // someone else cannot be presented here even if its id were known.
  if (!stored) throw new WebAuthnError("This device is not enrolled for your account")

  const verification = await verifyAuthenticationResponse({
    response: response as never,
    expectedChallenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(stored.public_key),
      counter: Number(stored.counter),
      transports: (stored.transports?.split(",") as never) ?? undefined,
    },
  })

  if (!verification.verified) throw new WebAuthnError("Biometric check failed")

  // A counter that has not moved means two authenticators are signing with the
  // same key — the credential has been cloned. simplewebauthn already rejects
  // that above; storing the new value is what keeps the next check honest.
  await client.query(
    `update public.webauthn_credentials
        set counter = $1, last_used_at = now()
      where id = $2`,
    [String(verification.authenticationInfo.newCounter), stored.id]
  )

  return true
}

/** Thrown for anything the user should see a message about, rather than a 500. */
export class WebAuthnError extends Error {}

export const webauthnConfig = { rpId: RP_ID, rpName: RP_NAME, origins: ORIGINS }

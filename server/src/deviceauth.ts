import crypto from "node:crypto"
import type { PoolClient } from "pg"

/**
 * The native app's half of biometric attendance.
 *
 * React Native has no WebAuthn, so the mobile app rebuilds the property rather
 * than the API: the phone holds an ed25519 private key in its OS keystore
 * behind a Face ID or fingerprint gate, and proves each punch by signing a
 * challenge this server issued. Verification here is the same shape as the
 * WebAuthn path — challenge in, signature checked, only then does anything
 * reach the attendance table.
 *
 * The alternative the platform makes easy is for the app to run a biometric
 * check and POST `{"verified": true}`. That is a claim, not evidence: a patched
 * build sends the same body without ever showing a prompt, and the server has
 * no way to tell the two apart. Since the entire point of the feature is that
 * an attendance record means something, a claim is not good enough.
 *
 * What differs from WebAuthn, stated plainly: there is no signature counter, so
 * a private key successfully extracted from a compromised device would not
 * announce itself the way a cloned WebAuthn credential does. The threat this
 * defends against is a colleague punching in for an absent friend, and against
 * that it holds.
 */

const CHALLENGE_TTL_MS = 120_000

const challenges = new Map<number, { challenge: string; expires: number }>()

/**
 * Issues a single-use challenge.
 *
 * In memory for the same reason as the WebAuthn one: it is worthless a minute
 * after issue, and a restart costs a user one retap. Two server instances would
 * need this shared, since the instance that verifies may not be the one that
 * issued.
 */
export function issueChallenge(userId: number): string {
  const now = Date.now()
  for (const [key, entry] of challenges) if (entry.expires < now) challenges.delete(key)

  const challenge = crypto.randomBytes(32).toString("hex")
  challenges.set(userId, { challenge, expires: now + CHALLENGE_TTL_MS })
  return challenge
}

/** Reads and spends a challenge: a replay of the same one finds nothing. */
function takeChallenge(userId: number): string | null {
  const entry = challenges.get(userId)
  challenges.delete(userId)
  if (!entry || entry.expires < Date.now()) return null
  return entry.challenge
}

export class DeviceAuthError extends Error {}

export async function registerDevice(
  client: PoolClient,
  userId: number,
  companyId: number | null,
  publicKeyHex: string,
  label: string | null
) {
  if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) {
    throw new DeviceAuthError("Malformed device key")
  }

  // One row per device: re-enrolling the same phone replaces its key rather
  // than accumulating dead ones that can never be used again.
  await client.query(
    `insert into public.mobile_device_credentials (user_id, public_key, label, company_id)
     values ($1, $2, $3, $4)
     on conflict (public_key) do update set label = excluded.label, last_used_at = null`,
    [userId, publicKeyHex, label, companyId]
  )
}

/**
 * Verifies a signature over the challenge just issued to this user.
 *
 * Every enrolled key for the account is tried, because the phone does not say
 * which of them it used — someone with a work phone and a personal one has two,
 * and both are legitimate.
 */
export async function verifyDeviceSignature(
  client: PoolClient,
  userId: number,
  signatureHex: string
): Promise<void> {
  const challenge = takeChallenge(userId)
  if (!challenge) throw new DeviceAuthError("Verification expired — try again")

  if (!/^[0-9a-f]{128}$/.test(signatureHex)) {
    throw new DeviceAuthError("Malformed signature")
  }

  const { rows } = await client.query<{ id: number; public_key: string }>(
    `select id, public_key from public.mobile_device_credentials where user_id = $1`,
    [userId]
  )
  if (rows.length === 0) throw new DeviceAuthError("This device is not set up for check-in")

  const message = Buffer.from(challenge, "utf8")
  const signature = Buffer.from(signatureHex, "hex")

  for (const row of rows) {
    if (verifyEd25519(row.public_key, message, signature)) {
      await client.query(
        `update public.mobile_device_credentials set last_used_at = now() where id = $1`,
        [row.id]
      )
      return
    }
  }

  throw new DeviceAuthError("Biometric check failed")
}

/**
 * Checks one ed25519 signature.
 *
 * Node will not import a bare 32-byte key, so the raw public key is wrapped in
 * the DER prefix that marks it as ed25519 SubjectPublicKeyInfo. The prefix is
 * fixed for this curve, which is why it can be a constant rather than something
 * assembled per key.
 */
function verifyEd25519(publicKeyHex: string, message: Buffer, signature: Buffer): boolean {
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyHex, "hex"),
    ])
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" })
    return crypto.verify(null, message, key, signature)
  } catch {
    // A stored key that cannot be parsed is a failed verification, never a
    // crash — one bad row must not stop the other devices being tried.
    return false
  }
}

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser"
import { apiRequest } from "@/lib/supabase"
import { getAttendanceRecord } from "@/features/attendance/api"
import type { AttendanceRecord } from "@/features/attendance/types"

/**
 * Biometric check-in from the browser: Face ID, Touch ID or an Android
 * fingerprint, whichever the phone has.
 *
 * The browser's part of this is deliberately thin, and it matters that it stays
 * that way. Every call here returns something the server has already verified —
 * this file cannot decide that a check passed. `startAuthentication` produces a
 * signature; whether that signature is worth anything is settled in
 * server/src/webauthn.ts against a challenge the server issued. Code here that
 * "checked the result" and then called a plain check-in endpoint would be
 * security theatre, since anyone can call that endpoint directly.
 *
 * The selfie is the same story from the other side: it rides along with the
 * punch as evidence for whoever reviews the log, and no decision anywhere
 * depends on it.
 */

export interface EnrolledDevice {
  id: number
  deviceLabel: string | null
  transports: string | null
  createdAt: string
  lastUsedAt: string | null
}

/**
 * Whether this device can do biometric check-in at all.
 *
 * Two separate questions, and they fail differently: a browser without WebAuthn
 * can never do it, while a browser that has WebAuthn but no platform
 * authenticator is usually a desktop with no sensor — where the honest answer
 * is "use the normal check-in button", not an error.
 *
 * WebAuthn also requires a secure context, so this returns false on plain HTTP
 * from anything but localhost. That is the usual reason it appears to be
 * "broken" on a phone: the phone is reaching the dev server over http://<lan-ip>.
 */
export async function biometricAvailable(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false
  try {
    return await platformAuthenticatorIsAvailable()
  } catch {
    return false
  }
}

export async function listDevices(): Promise<EnrolledDevice[]> {
  const rows = await apiRequest("/webauthn/credentials")
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    deviceLabel: (r.device_label as string) ?? null,
    transports: (r.transports as string) ?? null,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string) ?? null,
  }))
}

/** Enrols this device. The phone prompts for the biometric during startRegistration. */
export async function enrolDevice(label: string): Promise<void> {
  const options = await apiRequest("/webauthn/register/options", { method: "POST" })
  const response = await startRegistration({ optionsJSON: options })
  await apiRequest("/webauthn/register/verify", {
    method: "POST",
    body: JSON.stringify({ response, deviceLabel: label }),
  })
}

export async function removeDevice(id: number): Promise<void> {
  await apiRequest(`/webauthn/credentials/${id}`, { method: "DELETE" })
}

/**
 * Punches in or out behind a biometric prompt.
 *
 * The options call comes first and issues a one-shot challenge, so the window
 * between asking and punching is a couple of minutes at most; a captured
 * response cannot be replayed tomorrow.
 */
export async function biometricPunch(
  direction: "in" | "out",
  photo: string | null
): Promise<{ id: number; photoStored: boolean }> {
  const options = await apiRequest("/webauthn/punch/options", { method: "POST" })
  const response = await startAuthentication({ optionsJSON: options })
  return (await apiRequest(`/webauthn/punch/${direction}`, {
    method: "POST",
    body: JSON.stringify({ response, photo }),
  })) as { id: number; photoStored: boolean }
}

/** Re-reads the punched record so the screen can show the stamped time. */
export async function getRecordById(id: number): Promise<AttendanceRecord> {
  return getAttendanceRecord(id)
}

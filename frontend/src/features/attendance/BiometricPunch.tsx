import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Fingerprint, ScanFace, Camera, CameraOff, Trash2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { biometricAvailable, biometricPunch, enrolDevice, listDevices, removeDevice } from "@/features/attendance/biometric"
import type { AttendanceRecord } from "@/features/attendance/types"

/**
 * The phone-facing check-in: hold your face or finger to the sensor, and the
 * punch is signed by a key only that device holds.
 *
 * The camera here is a witness, not a lock. It photographs whoever is standing
 * there and files the shot against the record for a human to look at later;
 * every decision about whether the punch is allowed has already been made by
 * the signature. Wiring it the other way round — matching the photo to decide —
 * would be both weaker (a photo of a photo passes) and heavier (it would mean
 * holding face templates, which is sensitive personal data under the DPDP Act).
 *
 * So the camera is genuinely optional, and the UI says so: refusing the
 * permission costs the audit trail a picture and nothing else.
 */

const VIDEO_W = 480
const VIDEO_H = 480

function useSelfieCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: VIDEO_W, height: VIDEO_H }, audio: false })
      .then((stream) => {
        // The effect can be torn down while getUserMedia is still resolving —
        // on a fast tab switch, for instance. Without this the stream is
        // orphaned and the camera light stays on with nothing displaying it.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setDenied(true)
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setReady(false)
    }
  }, [enabled])

  /** Grabs a frame as a JPEG data URL, or null if there is nothing to grab. */
  const capture = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !ready) return null
    const canvas = document.createElement("canvas")
    canvas.width = VIDEO_W
    canvas.height = VIDEO_H
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    // 0.7 keeps a 480px selfie comfortably inside the server's 2MB ceiling.
    return canvas.toDataURL("image/jpeg", 0.7)
  }, [ready])

  return { videoRef, ready, denied, capture }
}

export function BiometricPunch({ today }: { today: AttendanceRecord | null | undefined }) {
  const queryClient = useQueryClient()
  const [supported, setSupported] = useState<boolean | null>(null)
  const [useCamera, setUseCamera] = useState(true)
  const { videoRef, ready, denied, capture } = useSelfieCamera(useCamera)

  useEffect(() => {
    biometricAvailable().then(setSupported)
  }, [])

  const { data: devices } = useQuery({
    queryKey: ["webauthn", "devices"],
    queryFn: listDevices,
    enabled: supported === true,
  })

  const enrol = useMutation({
    mutationFn: () => enrolDevice(deviceLabel()),
    onSuccess: () => {
      toast.success("This device is set up for biometric check-in")
      queryClient.invalidateQueries({ queryKey: ["webauthn", "devices"] })
    },
    onError: (e: { message?: string }) => toast.error(e.message ?? "Could not set up this device"),
  })

  const forget = useMutation({
    mutationFn: removeDevice,
    onSuccess: () => {
      toast.success("Device removed")
      queryClient.invalidateQueries({ queryKey: ["webauthn", "devices"] })
    },
  })

  const punch = useMutation({
    mutationFn: (direction: "in" | "out") => biometricPunch(direction, capture()),
    onSuccess: (result, direction) => {
      toast.success(
        direction === "in" ? "Checked in" : "Checked out",
        { description: result.photoStored ? "Verified, photo saved" : "Verified" }
      )
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (e: { message?: string }) => {
      // A cancelled prompt throws too, and telling someone their check "failed"
      // when they simply dismissed it is needlessly alarming.
      const message = e.message ?? ""
      if (/NotAllowed|abort|cancel/i.test(message)) return toast("Check-in cancelled")
      toast.error(message || "Biometric check failed")
    },
  })

  const enrolled = (devices?.length ?? 0) > 0
  const checkedIn = Boolean(today?.checkIn)
  const checkedOut = Boolean(today?.checkOut)

  if (supported === null) return null

  if (supported === false) {
    return (
      <Card className="rounded-md border shadow-none">
        <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
          <Fingerprint className="mt-0.5 size-5 shrink-0" />
          <p>
            This device has no fingerprint or face sensor available to the browser, so
            biometric check-in is not offered here. Use the buttons above, or open the
            portal on your phone.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-md border shadow-none">
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-success" />
          <div>
            <p className="text-sm font-medium">Biometric check-in</p>
            <p className="text-xs text-muted-foreground">
              Verified by this device. Your fingerprint and face never leave the phone.
            </p>
          </div>
        </div>

        {!enrolled ? (
          <Button onClick={() => enrol.mutate()} disabled={enrol.isPending} className="rounded-md">
            <ScanFace className="mr-2 size-4" />
            {enrol.isPending ? "Follow the prompt…" : "Set up on this device"}
          </Button>
        ) : (
          <>
            {useCamera && !denied && (
              <div className="relative overflow-hidden rounded-md bg-muted">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  // Mirrored, because an unmirrored self-view reads as wrong to
                  // everyone who has ever used a front camera.
                  className="mx-auto aspect-square w-full max-w-64 -scale-x-100 object-cover"
                />
                {!ready && (
                  <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    Starting camera…
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                className="rounded-md"
                disabled={checkedIn || punch.isPending}
                onClick={() => punch.mutate("in")}
              >
                <Fingerprint className="mr-2 size-4" />
                Check in
              </Button>
              <Button
                variant="secondary"
                className="rounded-md"
                disabled={!checkedIn || checkedOut || punch.isPending}
                onClick={() => punch.mutate("out")}
              >
                <Fingerprint className="mr-2 size-4" />
                Check out
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
                onClick={() => setUseCamera((on) => !on)}
              >
                {useCamera ? <CameraOff className="size-3.5" /> : <Camera className="size-3.5" />}
                {useCamera ? "Turn photo off" : "Turn photo on"}
              </button>
              {denied && <span>Camera blocked — check-in still works</span>}
            </div>

            <ul className="flex flex-col gap-1 border-t pt-3">
              {devices?.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-xs">
                  <span className="truncate text-muted-foreground">
                    {d.deviceLabel ?? "This device"}
                    {d.lastUsedAt && ` · last used ${new Date(d.lastUsedAt).toLocaleDateString()}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${d.deviceLabel ?? "device"}`}
                    className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-danger"
                    onClick={() => forget.mutate(d.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** A name someone will recognise in their device list, from what the UA admits to. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return "iPhone"
  if (/iPad/.test(ua)) return "iPad"
  if (/Android/.test(ua)) return "Android phone"
  if (/Macintosh/.test(ua)) return "Mac"
  if (/Windows/.test(ua)) return "Windows PC"
  return "This device"
}

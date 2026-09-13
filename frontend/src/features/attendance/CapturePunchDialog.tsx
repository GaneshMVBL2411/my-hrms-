import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Takes the photograph that goes with a browser punch.
 *
 * The order is the point, and it is the same order the native app uses: the
 * picture is taken first and the punch is recorded second, so a record either
 * has its photo or does not exist. Recording the time and then asking for a
 * photo would produce attendance rows whose evidence someone declined after
 * the fact, which is worse than no photo at all — it looks like one went
 * missing.
 *
 * Declining is still allowed, but before the punch rather than after: closing
 * this dialog cancels the whole thing.
 */
export function CapturePunchDialog({
  direction,
  busy,
  onCancel,
  onCapture,
}: {
  direction: "in" | "out"
  busy: boolean
  onCancel: () => void
  onCapture: (photo: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // Bumped by "Try again". Re-running the effect is what re-asks the browser,
  // and a permission granted in the address bar only takes effect on the next
  // ask — closing and reopening the dialog was the only way to do that before.
  const [attempt, setAttempt] = useState(0)

  const stop = useCallback(() => {
    // Every track, explicitly. Dropping the reference does not turn the camera
    // off, and a webcam light left on after a dialog closes is alarming in a
    // way that is entirely the application's fault.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setReady(false)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser will not give the page a camera. Try Chrome, Edge or Safari over HTTPS.")
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          setReady(true)
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        // Refusal and absence read very differently to someone standing there,
        // so they are not collapsed into one message.
        // The two places a block lives are easy to confuse, and only one of
        // them is visible from the page, so both are named.
        setError(
          e.name === "NotAllowedError"
            ? "The camera is blocked for this site. Click the camera icon in the address bar and choose Allow — or, if there is no icon, turn on camera access for your browser in the system's privacy settings. Then try again."
            : e.name === "NotFoundError"
              ? "No camera was found on this device."
              : e.name === "NotReadableError"
                ? "Another app is using the camera. Close it, then try again."
                : "The camera could not be started."
        )
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [stop, attempt])

  const capture = () => {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement("canvas")
    // The frame's own size, not the element's: the element is styled and would
    // otherwise decide the resolution of the stored image.
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext("2d")
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    // 0.5 matches what the phone sends. The server caps the decoded image at
    // 2MB and drops anything larger without failing the punch, so the quality
    // that matters is the one that stays under it.
    onCapture(canvas.toDataURL("image/jpeg", 0.5))
    stop()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {direction === "in" ? "Photo for check in" : "Photo for check out"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Taken now and stored with the record. Your attendance is not marked until you take it.
          </p>
        </DialogHeader>

        <div className="relative mt-2 aspect-square overflow-hidden rounded-xl border border-border bg-muted">
          {/* The video stays mounted even while an error is showing. On a
              retry the camera can answer before React has re-rendered, and a
              stream that arrives to an unmounted element has nowhere to go —
              the request succeeds and the preview stays blank. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            // Mirrored, because an unmirrored self-view is disconcerting —
            // people expect a mirror when looking at themselves. Only the
            // preview is flipped; the captured frame is drawn from the
            // source and is the right way round.
            className="size-full -scale-x-100 object-cover"
            onLoadedMetadata={() => setReady(true)}
          />
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center">
              <X className="size-6 text-danger" />
              <p className="max-w-xs text-xs text-muted-foreground">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw className="mr-1.5 size-3.5" />
                Try again
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={capture} disabled={!ready || !!error || busy}>
            {busy ? (
              <>
                <RefreshCw className="mr-2 size-4 animate-spin" />
                Recording…
              </>
            ) : (
              <>
                <Camera className="mr-2 size-4" />
                Take photo &amp; {direction === "in" ? "check in" : "check out"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

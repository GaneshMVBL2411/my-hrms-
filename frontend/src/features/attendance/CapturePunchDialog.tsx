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

  const stop = useCallback(() => {
    // Every track, explicitly. Dropping the reference does not turn the camera
    // off, and a webcam light left on after a dialog closes is alarming in a
    // way that is entirely the application's fault.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

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
        setError(
          e.name === "NotAllowedError"
            ? "The camera was blocked. Allow it in the address bar, then try again."
            : e.name === "NotFoundError"
              ? "No camera was found on this device."
              : "The camera could not be started."
        )
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [stop])

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
          {error ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
              <X className="size-6 text-danger" />
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          ) : (
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

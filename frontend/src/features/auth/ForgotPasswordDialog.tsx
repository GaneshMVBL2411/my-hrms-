import { useState } from "react"
import { Loader2, MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { requestPasswordReset } from "@/features/auth/authApi"
import { errorMessage } from "@/lib/errors"

/**
 * Asks for a reset link.
 *
 * The confirmation is the server's own sentence, and it is careful: it says a
 * link is on its way *if* the address has an account. That hedge is the feature.
 * A dialog that answered "no account with that address" would let anyone stand
 * at a public sign-in page and test whether a given person works here, which is
 * the list a phishing campaign is built from — so this cannot confirm delivery,
 * and does not pretend to.
 */
export function ForgotPasswordDialog({
  open,
  onOpenChange,
  /** Whatever is already typed in the sign-in form, which is usually the one. */
  defaultEmail = "",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultEmail?: string
}) {
  const [email, setEmail] = useState(defaultEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setSent(await requestPasswordReset(email))
    } catch (err) {
      // Only transport failures and the rate limiter land here — a valid
      // request answers 200 whether or not the address is known.
      setError(errorMessage(err, "Could not reach the server. Try again."))
    } finally {
      setBusy(false)
    }
  }

  // Reopening after a send should ask again rather than show a stale
  // confirmation for an address that may no longer be the one wanted.
  const close = (next: boolean) => {
    if (!next) {
      setSent(null)
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton className="max-w-md rounded-md">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MailCheck className="size-5 text-primary" />
                Check your email
              </DialogTitle>
              <DialogDescription>{sent}</DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              The link expires in 30 minutes, and using it signs out every device currently
              signed in.
            </p>
            <DialogFooter>
              <Button className="rounded-md" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Reset your password</DialogTitle>
              <DialogDescription>
                Enter your work email and we will send you a link to set a new password.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@whhoohhpath.com"
                className="rounded-md"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                className="rounded-md"
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !email.trim()} className="rounded-md">
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Send link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

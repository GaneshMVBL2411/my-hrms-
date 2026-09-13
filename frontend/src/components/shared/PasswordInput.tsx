import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A password field that can be read back.
 *
 * Exists because a masked field gives no feedback about what was actually
 * typed. That is not merely inconvenient: on Android the login screen silently
 * capitalised the first character, so a correct password was rejected as
 * "Invalid email or password" with nothing on screen to explain it. The same
 * class of mistake — a stray autocorrect, a keyboard layout, a trailing space —
 * is invisible in every other password field for the same reason.
 *
 * A component rather than four copies of the markup, so the toggle behaves
 * identically everywhere and a fix lands once. LoginPage predates this and
 * keeps its own inline version; it is the same behaviour.
 *
 * The ref is forwarded because every caller here registers the field with
 * react-hook-form, which needs the underlying input to read its value.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        // Room for the button, so a long password does not run under it.
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        // tabIndex -1 keeps Tab moving between fields rather than stopping on
        // the toggle, which is what someone filling in a form expects.
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
      >
        {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </button>
    </div>
  )
})

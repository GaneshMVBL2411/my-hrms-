import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AnimatedLogo } from "@/components/shared/AnimatedLogo"
import { resetPassword } from "@/features/auth/authApi"
import { errorMessage } from "@/lib/errors"

/**
 * Where a password-reset email lands.
 *
 * Public by design: someone resetting a password cannot sign in, so this sits
 * outside ProtectedRoute and the token in the URL is the only credential. That
 * is also why the route is registered before the catch-all — a signed-out
 * visitor hitting a guarded path is bounced to /login, and this must not be.
 *
 * The composition rules are stated up front rather than only on rejection. They
 * are enforced by assert_password_policy in the database, and a form that waits
 * to be told is a round trip that could have been avoided; the client check is
 * a courtesy and the database remains the authority.
 */

const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/[A-Z]/, "Needs an uppercase letter")
      .regex(/[a-z]/, "Needs a lowercase letter")
      .regex(/[0-9]|[^A-Za-z0-9]/, "Needs a number or symbol"),
    confirm: z.string().min(1, "Confirm the password"),
  })
  .refine((values) => values.password === values.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  })

type ResetFormValues = z.infer<typeof resetSchema>

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get("token") ?? ""
  const [showPassword, setShowPassword] = useState(false)
  const [done, setDone] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirm: "" },
  })

  const onSubmit = async (values: ResetFormValues) => {
    try {
      const message = await resetPassword(token, values.password)
      setDone(true)
      toast.success(message)
      // Long enough to read the confirmation, short enough not to feel stuck.
      setTimeout(() => navigate("/login", { replace: true }), 2500)
    } catch (error) {
      // The server distinguishes a rejected password from an unusable link, and
      // the difference matters: one means choose another, the other means ask
      // for a new email. Attaching it to the field is what makes that visible.
      setError("password", {
        message: errorMessage(error, "This reset link is no longer valid"),
      })
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-4">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-8 sm:p-10">
        <div className="mb-8 flex items-center gap-2">
          <AnimatedLogo className="size-9" />
          <span className="text-lg font-semibold text-foreground">Whhoohh Path LLP</span>
        </div>

        {!token ? (
          <>
            <h1 className="text-2xl font-semibold text-foreground">Link not recognised</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This page needs the link from your reset email. Open that link directly, or ask
              for a new one from the sign-in page.
            </p>
            <Button asChild className="mt-6 w-full rounded-md">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </>
        ) : done ? (
          <>
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="size-5" />
              <h1 className="text-2xl font-semibold text-foreground">Password changed</h1>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Every device that was signed in has been signed out. Taking you to the sign-in
              page&hellip;
            </p>
            <Button asChild className="mt-6 w-full rounded-md">
              <Link to="/login">Sign in now</Link>
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-foreground">Choose a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              At least 8 characters, with an uppercase letter, a lowercase letter, and a number
              or symbol.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    autoFocus
                    placeholder="••••••••"
                    className="rounded-md pr-10"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="rounded-md"
                  {...register("confirm")}
                />
                {errors.confirm && (
                  <p className="text-xs text-destructive">{errors.confirm.message}</p>
                )}
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full rounded-md">
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Set new password
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Resetting signs out every device currently signed in.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

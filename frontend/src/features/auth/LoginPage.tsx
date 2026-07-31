import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import axios from "axios"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/features/auth/AuthContext"
import logoMark from "@/assets/logo-mark.png"

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean(),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: true },
  })

  if (user) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/dashboard"
    return <Navigate to={from} replace />
  }

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await signIn(values.email, values.password, values.rememberMe)
      navigate("/dashboard", { replace: true })
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          toast.error("Invalid email or password")
        } else if (error.response) {
          const detail = (error.response.data as { detail?: string })?.detail
          toast.error(detail ?? `Sign-in failed (server returned ${error.response.status})`)
        } else {
          toast.error("Could not reach the server. Check your connection and try again.")
        }
      } else {
        toast.error("Something went wrong. Please try again.")
      }
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-md border border-border bg-card md:grid-cols-2">
        <div className="hidden flex-col justify-between border-r border-border bg-secondary p-10 text-secondary-foreground md:flex">
          <div className="flex items-center gap-2">
            <img src={logoMark} alt="" className="size-10 object-contain" />
            <span className="text-lg font-semibold">Whhohh Path LLP</span>
          </div>

          <div className="space-y-3">
            <h2 className="text-2xl font-semibold leading-snug">
              One place for your people, projects and payroll.
            </h2>
            <p className="text-sm text-secondary-foreground/70">
              An HR platform built to scale from 7 to 500+ employees without missing a beat.
            </p>
          </div>

          <p className="text-xs text-secondary-foreground/50">
            &copy; {new Date().getFullYear()} Whhohh Path LLP. All rights reserved.
          </p>
        </div>

        <div className="flex flex-col justify-center p-8 sm:p-10">
          <div className="mb-8 flex items-center gap-2 md:hidden">
            <img src={logoMark} alt="" className="size-9 object-contain" />
            <span className="text-lg font-semibold text-foreground">Whhohh Path LLP</span>
          </div>

          <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your HRMS account to continue.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@whhohhpath.com"
                className="rounded-md"
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
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
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={watch("rememberMe")}
                  onCheckedChange={(checked) => setValue("rememberMe", checked === true)}
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => toast.info("Contact your HR admin to reset your password.")}
                className="text-sm font-medium text-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

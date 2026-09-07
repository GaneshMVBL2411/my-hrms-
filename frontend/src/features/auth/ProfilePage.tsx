import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Loader2, Sun, Moon, Monitor, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { PasswordInput } from "@/components/shared/PasswordInput"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { changePassword } from "@/features/auth/authApi"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/features/auth/AuthContext"

const schema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: z.string().min(8, "Minimum 8 characters"),
    confirmPassword: z.string().min(1, "Required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type FormValues = z.infer<typeof schema>

export function ProfilePage() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const mutation = useMutation({
    mutationFn: (values: FormValues) => changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      toast.success("Password updated")
      reset()
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not update password. Check your current password.")),
  })

  const initials = (user?.fullName ?? "?").slice(0, 2).toUpperCase()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5">
      <h1 className="text-xl font-semibold text-foreground">My Profile</h1>

      <Card className="rounded-2xl border border-border shadow-xs">
        <CardContent className="flex items-center gap-4 py-6">
          <Avatar className="size-16 rounded-2xl border-2 border-primary/20">
            <AvatarImage src={user?.photoUrl ?? undefined} />
            <AvatarFallback className="rounded-2xl text-base font-bold bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{user?.fullName}</h2>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
            <Badge variant="outline" className="mt-2 capitalize font-medium">
              {user?.role.replace("_", " ")}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Appearance & Theme Selector */}
      <Card className="rounded-2xl border border-border shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Appearance & Theme</CardTitle>
          <p className="text-xs text-muted-foreground">Choose how the HRMS interface appears on your screen</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                theme === "light"
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <Sun className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">Light Mode</p>
                <p className="text-[11px] text-muted-foreground">Clean light UI</p>
              </div>
              {theme === "light" && <Check className="size-4 text-primary shrink-0" />}
            </button>

            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                theme === "dark"
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Moon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">Dark Mode</p>
                <p className="text-[11px] text-muted-foreground">Deep dark palette</p>
              </div>
              {theme === "dark" && <Check className="size-4 text-primary shrink-0" />}
            </button>

            <button
              type="button"
              onClick={() => setTheme("system")}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                theme === "system"
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Monitor className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">System Default</p>
                <p className="text-[11px] text-muted-foreground">Match device settings</p>
              </div>
              {theme === "system" && <Check className="size-4 text-primary shrink-0" />}
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <PasswordInput autoComplete="current-password" {...register("currentPassword")} />
              {errors.currentPassword && (
                <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <PasswordInput autoComplete="new-password" {...register("newPassword")} />
              {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <PasswordInput autoComplete="new-password" {...register("confirmPassword")} />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

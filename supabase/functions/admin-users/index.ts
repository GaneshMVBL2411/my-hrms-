// Creating a login requires the Auth admin API, which requires the service key —
// the one thing a browser must never hold. This is the only piece of the retired
// backend that still needs to run somewhere privileged, so it lives here as a
// Supabase Edge Function rather than as a server the app has to deploy.
//
//   supabase functions deploy admin-users
//
// Every action re-checks the caller's role against the database; the JWT alone is
// never treated as proof of anything beyond identity.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0"

const HR_ROLES = ["founder", "hr_admin"]

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "Not authenticated" }, 401)

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: callerRole, error: roleError } = await caller.rpc("app_role")
  if (roleError) return json({ error: roleError.message }, 401)
  if (!callerRole) return json({ error: "Not authenticated" }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  const action = payload.action as string

  if (action === "create") {
    if (!HR_ROLES.includes(callerRole)) {
      return json({ error: "You don't have permission to perform this action" }, 403)
    }

    const email = String(payload.email ?? "").trim()
    const password = String(payload.password ?? "")
    const role = String(payload.role ?? "employee")
    const employee = (payload.employee ?? {}) as Record<string, unknown>

    if (!email || password.length < 8) {
      return json({ error: "An email and a password of at least 8 characters are required" }, 400)
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError) return json({ error: createError.message }, 400)

    const { data: employeeId, error: profileError } = await admin.rpc("create_employee_profile", {
      p_auth_id: created.user.id,
      p_email: email,
      p_role: role,
      p_employee: employee,
    })

    if (profileError) {
      // The login and the profile appear together or not at all — otherwise the
      // orphaned auth account blocks the email from ever being re-used.
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: profileError.message }, 400)
    }

    return json({ employeeId })
  }

  if (action === "set_password") {
    const employeeId = Number(payload.employeeId)
    const password = String(payload.password ?? "")
    if (!employeeId || password.length < 8) {
      return json({ error: "A password of at least 8 characters is required" }, 400)
    }

    const { data: target, error: lookupError } = await admin
      .from("users")
      .select("auth_id, employees!inner(id)")
      .eq("employees.id", employeeId)
      .maybeSingle()

    if (lookupError) return json({ error: lookupError.message }, 400)
    if (!target?.auth_id) return json({ error: "This employee has no login account" }, 404)

    // HR resets anyone's password; everyone else only their own.
    if (!HR_ROLES.includes(callerRole)) {
      const { data: ownEmployeeId } = await caller.rpc("app_employee_id")
      if (ownEmployeeId !== employeeId) {
        return json({ error: "You don't have permission to perform this action" }, 403)
      }
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_id, { password })
    if (updateError) return json({ error: updateError.message }, 400)

    return json({ ok: true })
  }

  return json({ error: `Unknown action: ${action}` }, 400)
})

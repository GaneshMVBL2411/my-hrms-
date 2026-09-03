/**
 * Makes the Neon database usable: sets the sign-in passwords, and gives the
 * application role a login of its own.
 *
 * WHY PASSWORDS HAVE TO BE SET RATHER THAN COPIED
 *
 * On Supabase the bcrypt hashes live in auth.users, which PostgREST does not
 * expose — no amount of HR access reaches them. So the hashes cannot be read
 * out with the keys available here, and the same passwords are re-established
 * instead. They are the documented seed credentials from
 * supabase/reset-passwords.sql, so nothing anyone actually uses changes.
 *
 * The hashes are produced by crypt(..., gen_salt('bf')) — bcrypt, byte-for-byte
 * the format GoTrue wrote. If you later export the real hashes from Supabase,
 * they can be dropped straight in over these.
 *
 * WHY hrms_app MATTERS
 *
 * neondb_owner owns every table, and Postgres exempts a table's owner from its
 * own row level security. Run the API as that role and all 62 policies are
 * inert: every company sees every other company's data, silently, with nothing
 * in the logs to suggest anything is wrong. hrms_app owns nothing, so the
 * policies apply to it.
 *
 *   npx tsx src/scripts/finalize-neon.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Pool } from "pg"

const envPath = new URL("../../.env", import.meta.url)
const envRaw = readFileSync(envPath, "utf8")

const env: Record<string, string> = {}
for (const line of envRaw.split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

// Typed as string outright rather than narrowed: the guard below proves it,
// but the narrowing does not survive into the async functions that use it.
const url: string = env.DATABASE_URL ?? ""
if (!url) throw new Error("DATABASE_URL is not set in server/.env")

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 1 })

/** Seed user accounts to bootstrap if they have no password set. */
const SEED_EMAILS: string[] = [
  "ravi.shanker@whhoohhpath.com",
  "hr@whhoohhpath.com",
  "ganesh.pm@whhoohhpath.com",
  "tarak.lead@whhoohhpath.com",
  "pavan.dev@whhoohhpath.com",
  "avinash.ai@whhoohhpath.com",
  "kalyani.aiwhhoohh@gmail.com",
]

async function main() {
  console.log("Checking accounts and initial passwords…\n")

  const allowOverwrite = process.env.ALLOW_PASSWORD_RESET === "true"
  const defaultPassword = process.env.INITIAL_BOOTSTRAP_PASSWORD

  for (const email of SEED_EMAILS) {
    // Safety check: ensure seed scripts cannot overwrite existing production credentials
    const { rows: existing } = await pool.query<{ password_hash: string | null }>(
      "select password_hash from public.users where lower(email) = lower($1)",
      [email]
    )
    if (existing.length === 0) {
      console.log(`  SKIP ${email} (no such user)`)
      continue
    }

    if (existing[0]?.password_hash && !allowOverwrite) {
      console.log(`  PRESERVED existing credentials for ${email}`)
      continue
    }

    const passwordToSet = defaultPassword ?? randomBytes(16).toString("base64url")
    const { rowCount } = await pool.query(
      `update public.users
          set password_hash      = crypt($2, gen_salt('bf', 12)),
              email_confirmed_at = coalesce(email_confirmed_at, now())
        where lower(email) = lower($1) ${allowOverwrite ? "" : "and password_hash is null"}`,
      [email, passwordToSet]
    )
    if (rowCount) {
      console.log(`  set initial credentials for ${email}`)
    }
  }

  // Anyone without a password would be unable to sign in at all
  const { rows: without } = await pool.query<{ email: string }>(
    "select email from public.users where password_hash is null order by email"
  )
  if (without.length > 0) {
    console.log(`\n  WITHOUT A PASSWORD (cannot sign in):`)
    without.forEach((u) => console.log(`    ${u.email}`))
  }

  // ------------------------------------------------------------- hrms_app
  console.log("\nGiving hrms_app a login…")
  const appPassword = randomBytes(24).toString("base64url")

  await pool.query(`alter role hrms_app with login password '${appPassword}'`)

  // Tables created after the role was granted are not covered by the earlier
  // grant, and the whole schema was created afterwards. Re-granted here.
  await pool.query("grant usage on schema public to hrms_app")
  await pool.query("grant select, insert, update, delete on all tables in schema public to hrms_app")
  await pool.query("grant usage, select on all sequences in schema public to hrms_app")
  await pool.query("grant execute on all functions in schema public to hrms_app")
  await pool.query("grant authenticated to hrms_app")

  // The blanket grant above is deliberately broad, but it is broader than two
  // tables can afford — and it silently undid both protections once already,
  // because "all tables" includes the ones with something to hide.
  //
  //   audit_logs   the application may append and read, never rewrite. An audit
  //                trail its subject can edit is not evidence of anything
  //                (ISO/IEC 27001 A.8.15), and hrms_app is what the API runs as.
  //   users        password_hash must not be selectable: any employee could
  //                otherwise read every colleague's bcrypt hash and crack it
  //                offline at leisure.
  //
  // Narrowed here rather than left to migrations 0017 and 0024 to repair
  // afterwards, so re-running this script cannot quietly reopen either hole.
  await pool.query("revoke update, delete on public.audit_logs from hrms_app")

  const { rows: userCols } = await pool.query<{ cols: string }>(
    `select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols
       from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name <> 'password_hash'`
  )
  if (userCols[0]?.cols) {
    await pool.query("revoke select on public.users from hrms_app")
    await pool.query(`grant select (${userCols[0].cols}) on public.users to hrms_app`)
  }

  const appUrl = url.replace(/\/\/[^:]+:[^@]+@/, `//hrms_app:${appPassword}@`)

  writeFileSync(
    envPath,
    envRaw
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${appUrl}`)
      // The owner connection is still needed for schema work, so it is kept
      // under a name the server never reads.
      .replace(/^JWT_SECRET=/m, `DATABASE_URL_OWNER=${url}\nJWT_SECRET=`)
  )

  console.log("  hrms_app can now log in")
  console.log("  server/.env DATABASE_URL repointed to hrms_app")
  console.log("  the owner connection kept as DATABASE_URL_OWNER for schema work")

  const { rows: owner } = await pool.query<{ n: string }>(
    "select count(*) as n from pg_tables where schemaname = 'public' and tableowner = 'hrms_app'"
  )
  console.log(`\n  tables owned by hrms_app: ${owner[0]!.n} (must be 0, or RLS is bypassed)`)

  await pool.end()
}

main().catch(async (error) => {
  console.error(`\nFailed: ${(error as Error).message}`)
  await pool.end().catch(() => {})
  process.exit(1)
})

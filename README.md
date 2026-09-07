# Whhoohh Path HRMS

A React SPA that talks straight to Supabase. There is no application server: the
database enforces every rule through row level security and a set of SQL
functions, so the whole app deploys to Vercel as static files.

```
supabase/migrations/   schema, security, read models, business logic
supabase/functions/    the one privileged operation (creating a login)
supabase/seed.mjs      demo people and sample data
frontend/              React + Vite + TanStack Query + shadcn/ui
docs/                  ER diagram
```

## Setup

### 1. Apply the migrations

Create a Supabase project, then run the files in `supabase/migrations/` **in
order** — via the SQL Editor, or with the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`0004_reference_data.sql` seeds roles, departments, designations and leave types.
`0005_storage.sql` creates the `hrms-files` bucket for employee photos.

### 2. Deploy the `admin-users` function

Creating an employee has to create a login, and that needs the Auth admin API
and the service key — the one thing a browser must never hold. It is the only
server-side code left:

```bash
supabase functions deploy admin-users
```

Without it, everything works except adding new employees.

### 3. Seed the demo people (optional)

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_KEY=<service_role key> \
node supabase/seed.mjs
```

Creates the six Whhoohh Path accounts, their leave balances and salary
structures, plus a sample project, policies and announcements. It prints the
credentials it created when it finishes.

Those passwords are hard-coded in `seed.mjs`, which means they are published in
this repository — treat them as bootstrap-only. **Change every one of them from
Profile → Change password before the system holds anything real.** The seed
skips any email that already has a login, so re-running it will not undo a
password you have changed.

### 4. Run the frontend

```bash
cd frontend
cp .env.example .env      # fill in your project URL and anon key
npm install
npm run dev
```

## Deploying to Vercel

Import the repository; `vercel.json` at the root already points the build at
`frontend/`. Set two environment variables in the Vercel project:

| Variable                 | Value                              |
| ------------------------ | ---------------------------------- |
| `VITE_SUPABASE_URL`      | `https://<ref>.supabase.co`        |
| `VITE_SUPABASE_ANON_KEY` | the project's anon/publishable key |

Both are baked into the bundle and are meant to be public — the anon key only
grants what the policies allow. Never add the `service_role` key.

## Troubleshooting

**400 on `/auth/v1/token?grant_type=password`.** Supabase Auth refused the
sign-in itself, before the app saw anything. Almost always it means no login
exists for that email — the migrations create tables, not accounts, so until
`seed.mjs` runs there is nobody to sign in as. Check **Authentication → Users**;
if it's empty, run the seed. If you seeded before the team was renamed, the old
addresses are what exist — re-run the seed to add the new ones (it skips emails
it already created).

A login and a profile are two separate things. A 400 means the *login* is
missing; "This account is not active" means the login worked but there is no
active `public.users` row behind it. [supabase/link-auth-user.sql](supabase/link-auth-user.sql)
repairs the second case and includes a query that shows which half each account
is missing.

**Blank page after deploying.** Vite inlines env vars at build time, so adding
them to Vercel does nothing until you redeploy. If the variables are missing
entirely you'll get a setup page naming them rather than a blank screen.

**Deep links 404 on refresh.** Vercel's Root Directory must stay at the
repository root so the rewrites in `vercel.json` apply; setting it to `frontend`
ignores that file.

## How authorisation works

There is no middleware to check a role, so the checks live in the database:

- **Row level security** decides which rows you can see or change. An employee
  reads their own attendance, leave, payslips and letters; HR (`founder`,
  `hr_admin`) reads everyone's.
- **Column grants** withhold PAN, Aadhaar and bank details from the `employees`
  table entirely. `get_employee_detail()` is the only way to read them, and it
  returns them to HR and to the employee themselves.
- **SECURITY DEFINER functions** cover everything that spans tables, needs to be
  atomic, or has to read rows the caller cannot (`decide_leave_request`,
  `generate_payslip`, `get_calendar`, the `report_*` family, and so on).
- **`update_task`** exists because permission there is per-field: anyone may move
  a task along the board, only a manager may re-scope it, and only the assignee
  may report a completion percentage.

Client-side `RoleGuard`s still hide what a role cannot use, but they are for
navigation only — the database refuses the operation regardless.

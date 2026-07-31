/**
 * Seeds Whhohh Path LLP's people and the sample data hanging off them.
 * Replaces the retired backend/seed.py.
 *
 * Reference rows (roles, departments, leave types, …) come from migration 0004 —
 * apply the migrations first. This needs the service key because creating a login
 * goes through the Auth admin API, so it runs from a terminal, never from the
 * deployed app. Idempotent: safe to re-run.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   node supabase/seed.mjs
 *
 * Deliberately dependency-free — it talks to the REST and Auth endpoints over
 * plain fetch. There is no node_modules at the repo root, and requiring an
 * install here just to create seven rows is one more thing to get wrong.
 * Needs Node 18+ for global fetch.
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "")
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(`Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running this script, e.g.

  SUPABASE_URL=https://xxxx.supabase.co \\
  SUPABASE_SERVICE_KEY=<service_role key from Settings -> API> \\
  node supabase/seed.mjs
`)
  process.exit(1)
}

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
}

async function request(path, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: prefer ? { ...HEADERS, Prefer: prefer } : HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    const detail =
      payload?.message ?? payload?.msg ?? payload?.error_description ?? payload?.hint ?? text
    throw new Error(`${method} ${path} -> ${response.status}: ${detail || response.statusText}`)
  }

  return payload
}

const rest = {
  select: (table, query = "") => request(`/rest/v1/${table}?${query}`),
  insert: (table, rows) =>
    request(`/rest/v1/${table}`, { method: "POST", body: rows, prefer: "return=representation" }),
  /** Skips rows that already exist rather than overwriting them. */
  insertIgnoringDuplicates: (table, rows, onConflict) =>
    request(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      body: rows,
      prefer: "resolution=ignore-duplicates,return=minimal",
    }),
  rpc: (fn, args) => request(`/rest/v1/rpc/${fn}`, { method: "POST", body: args }),
}

const auth = {
  createUser: (email, password) =>
    request("/auth/v1/admin/users", {
      method: "POST",
      body: { email, password, email_confirm: true },
    }),
  deleteUser: (id) => request(`/auth/v1/admin/users/${id}`, { method: "DELETE" }),
}

// `lastName` is blank for anyone who goes by a single name; `full_name` trims,
// so nothing renders with a trailing space. `gender` is left unset rather than
// guessed from a name — HR can fill it in from the employee form.
const EMPLOYEES = [
  {
    email: "ravi.shanker@whhohhpath.com", password: "Founder@123",
    firstName: "Ravi", lastName: "Shanker", role: "founder",
    department: "Operations", designation: "Founder & CEO",
    joiningDate: "2021-01-01", gender: "male",
  },
  {
    email: "hr@whhohhpath.com", password: "HrAdmin@123",
    firstName: "Bhavya", lastName: "Sri", role: "hr_admin",
    department: "Operations", designation: "HR Executive",
    joiningDate: "2022-03-15",
  },
  {
    email: "ganesh.pm@whhohhpath.com", password: "Manager@123",
    firstName: "Ganesh", lastName: "", role: "project_manager",
    department: "Engineering", designation: "Software Engineer",
    joiningDate: "2022-06-01",
  },
  {
    email: "tarak.lead@whhohhpath.com", password: "TeamLead@123",
    firstName: "Tarak", lastName: "", role: "team_lead",
    department: "Engineering", designation: "Software Engineer",
    joiningDate: "2022-09-12",
  },
  {
    email: "pavan.dev@whhohhpath.com", password: "Employee@123",
    firstName: "Pavan", lastName: "", role: "employee",
    department: "Engineering", designation: "Software Engineer",
    joiningDate: "2023-02-20",
  },
  {
    email: "avinash.ai@whhohhpath.com", password: "Employee@123",
    firstName: "Avinash", lastName: "", role: "employee",
    department: "AI/ML", designation: "AI Engineer",
    joiningDate: "2023-11-03",
  },
]

const ROLE_BASIC_PAY = {
  founder: 150000,
  hr_admin: 60000,
  project_manager: 90000,
  team_lead: 75000,
  employee: 50000,
}

function daysFromNow(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

async function lookup(table, column) {
  const rows = await rest.select(table, `select=id,${column}`)
  return Object.fromEntries(rows.map((row) => [row[column], row.id]))
}

async function seedEmployees(departments, designations) {
  const existing = await rest.select("users", "select=email")
  const known = new Set(existing.map((user) => user.email.toLowerCase()))

  for (const person of EMPLOYEES) {
    if (known.has(person.email.toLowerCase())) {
      console.log(`  · ${person.email} already exists, skipping`)
      continue
    }

    const account = await auth.createUser(person.email, person.password)

    try {
      await rest.rpc("create_employee_profile", {
        p_auth_id: account.id,
        p_email: person.email,
        p_role: person.role,
        p_employee: {
          first_name: person.firstName,
          last_name: person.lastName,
          gender: person.gender ?? null,
          department_id: departments[person.department],
          designation_id: designations[person.designation],
          joining_date: person.joiningDate,
          experience_years: 2,
          skills: ["Communication", "Teamwork"],
          status: "active",
        },
      })
    } catch (error) {
      // A login without a profile cannot sign in and blocks the address from
      // ever being reused, so roll it back rather than leave it orphaned.
      await auth.deleteUser(account.id).catch(() => {})
      throw new Error(`Creating the profile for ${person.email} failed: ${error.message}`)
    }

    console.log(`  · created ${person.email} (${person.role})`)
  }
}

async function seedLeaveBalances(employees) {
  const leaveTypes = await rest.select("leave_types", "select=id,default_days_per_year")
  const year = new Date().getFullYear()

  const rows = employees.flatMap((employee) =>
    leaveTypes.map((type) => ({
      employee_id: employee.id,
      leave_type_id: type.id,
      year,
      allocated_days: type.default_days_per_year,
      used_days: 0,
    }))
  )

  await rest.insertIgnoringDuplicates("leave_balances", rows, "employee_id,leave_type_id,year")
  console.log(`  · ${rows.length} leave balances`)
}

async function seedSalaryStructures(employees) {
  const rows = employees.map((employee) => {
    const basic = ROLE_BASIC_PAY[employee.role] ?? ROLE_BASIC_PAY.employee
    return {
      employee_id: employee.id,
      basic,
      hra: basic * 0.4,
      special_allowance: basic * 0.15,
      pf_percent: 12,
      esi_percent: 0.75,
      effective_from: employee.joiningDate ?? new Date().toISOString().slice(0, 10),
    }
  })

  await rest.insertIgnoringDuplicates("salary_structures", rows, "employee_id")
  console.log(`  · ${rows.length} salary structures`)
}

async function seedSampleProject(employees) {
  const existing = await rest.select("projects", "select=id&name=eq.HRMS%20Platform")
  if (existing.length > 0) {
    console.log("  · sample project already exists, skipping")
    return
  }

  const byFirstName = Object.fromEntries(employees.map((e) => [e.firstName, e]))
  const founder = employees.find((e) => e.role === "founder")
  const manager = employees.find((e) => e.role === "project_manager")
  if (!founder || !manager) return

  const [project] = await rest.insert("projects", {
    name: "HRMS Platform",
    description: "Internal HR management system for Whhohh Path LLP.",
    tech_stack: ["React", "Supabase", "PostgreSQL"],
    priority: "high",
    status: "active",
    deadline: daysFromNow(60),
    progress: 35,
    created_by: founder.userId,
  })

  const members = ["Ganesh", "Tarak", "Pavan"]
    .map((name) => byFirstName[name])
    .filter(Boolean)
    .map((employee) => ({
      project_id: project.id,
      employee_id: employee.id,
      role_in_project: "Developer",
    }))
  if (members.length > 0) await rest.insert("project_members", members)

  const tasks = await rest.insert("tasks", [
    {
      project_id: project.id,
      title: "Design database schema",
      description: "Model core HR entities and relationships.",
      assigned_to: byFirstName.Tarak?.id ?? null,
      priority: "high",
      due_date: daysFromNow(5),
      status: "completed",
      created_by: manager.userId,
    },
    {
      project_id: project.id,
      title: "Build employee management UI",
      description: "List, profile, and edit screens for employees.",
      assigned_to: byFirstName.Pavan?.id ?? null,
      priority: "medium",
      due_date: daysFromNow(10),
      status: "in_progress",
      created_by: manager.userId,
    },
  ])

  const uiTask = tasks.find((task) => task.title === "Build employee management UI")
  await rest.insert("task_checklist_items", [
    { task_id: uiTask.id, label: "List page", is_done: true },
    { task_id: uiTask.id, label: "Profile page", is_done: true },
    { task_id: uiTask.id, label: "Edit form", is_done: false },
  ])

  console.log("  · sample project 'HRMS Platform' with 2 tasks")
}

async function seedContent(employees) {
  const founder = employees.find((e) => e.role === "founder")
  const hr = employees.find((e) => e.role === "hr_admin")

  const policies = await rest.select("policies", "select=id&title=eq.Leave%20Policy")
  if (founder && policies.length === 0) {
    await rest.insert("policies", [
      {
        title: "Leave Policy",
        content:
          "All employees are entitled to Casual, Sick, Paid, Work From Home and Comp Off leave as per " +
          "their leave balance. Leave requests should be submitted in advance via the Leaves module and " +
          "require HR approval.",
        updated_by: founder.userId,
      },
      {
        title: "Code of Conduct",
        content:
          "Employees are expected to act with integrity, respect colleagues, and safeguard company and " +
          "client data. Violations should be reported to HR.",
        updated_by: founder.userId,
      },
    ])
    console.log("  · 2 policies")
  }

  const announcements = await rest.select("announcements", "select=id&title=eq.Welcome%20to%20the%20new%20HRMS")
  if (hr && announcements.length === 0) {
    await rest.insert("announcements", [
      {
        title: "Welcome to the new HRMS",
        body:
          "We've moved to a new in-house HR platform. Explore Attendance, Leaves, Projects, Tasks and " +
          "more from the sidebar.",
        category: "news",
        pinned: true,
        created_by: hr.userId,
      },
      {
        title: "Office closed for Independence Day",
        body: "The office will remain closed on August 15th for Independence Day.",
        category: "holiday",
        pinned: false,
        created_by: hr.userId,
      },
    ])
    console.log("  · 2 announcements")
  }
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL}\n`)

  const [departments, designations] = await Promise.all([
    lookup("departments", "name"),
    lookup("designations", "title"),
  ])

  if (Object.keys(departments).length === 0) {
    throw new Error(
      "No departments found. Apply supabase/migrations/*.sql in order before seeding — " +
        "the migrations create the tables and reference data, this script only adds people."
    )
  }

  console.log("People:")
  await seedEmployees(departments, designations)

  const rows = await rest.select(
    "employees",
    "select=id,first_name,joining_date,user_id,users!inner(roles!inner(name))"
  )
  const employees = rows.map((row) => {
    const user = Array.isArray(row.users) ? row.users[0] : row.users
    const role = Array.isArray(user?.roles) ? user.roles[0] : user?.roles
    return {
      id: row.id,
      firstName: row.first_name,
      joiningDate: row.joining_date,
      userId: row.user_id,
      role: role?.name,
    }
  })

  console.log("\nReference data:")
  await seedLeaveBalances(employees)
  await seedSalaryStructures(employees)

  console.log("\nSample content:")
  await seedSampleProject(employees)
  await seedContent(employees)

  console.log("\nSign in with any of these:\n")
  for (const person of EMPLOYEES) {
    console.log(`  ${person.role.padEnd(16)} ${person.email.padEnd(32)} ${person.password}`)
  }
  console.log("\nChange these passwords before anyone real uses the system.")
}

main().catch((error) => {
  console.error(`\nSeeding failed: ${error.message}`)
  process.exit(1)
})

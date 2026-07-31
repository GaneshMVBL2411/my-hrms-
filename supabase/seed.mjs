/**
 * Seeds Whhohh Path LLP's demo people and the sample data hanging off them.
 * Replaces the retired backend/seed.py.
 *
 * Reference rows (roles, departments, leave types, …) come from migration 0004 —
 * run the migrations first. This script needs the service key because creating a
 * login goes through the Auth admin API, so it runs from a terminal, never from
 * the deployed app. Idempotent: safe to re-run.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   node supabase/seed.mjs
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running this script.")
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

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

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`)
}

function daysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function lookup(table, column) {
  const { data, error } = await db.from(table).select(`id, ${column}`)
  if (error) throw new Error(`Reading ${table}: ${error.message}`)
  return Object.fromEntries(data.map((row) => [row[column], row.id]))
}

async function seedEmployees(departments, designations) {
  const { data: existing } = await db.from("users").select("email")
  const known = new Set((existing ?? []).map((u) => u.email.toLowerCase()))

  for (const person of EMPLOYEES) {
    if (known.has(person.email.toLowerCase())) {
      console.log(`Skipping existing user ${person.email}`)
      continue
    }

    const { data: created, error: authError } = await db.auth.admin.createUser({
      email: person.email,
      password: person.password,
      email_confirm: true,
    })
    if (authError) throw new Error(`Creating login for ${person.email}: ${authError.message}`)

    const { error: profileError } = await db.rpc("create_employee_profile", {
      p_auth_id: created.user.id,
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
    if (profileError) {
      await db.auth.admin.deleteUser(created.user.id)
      throw new Error(`Creating profile for ${person.email}: ${profileError.message}`)
    }

    console.log(`Created ${person.email} (${person.role})`)
  }
}

async function seedLeaveBalances(employees) {
  const { data: leaveTypes, error } = await db.from("leave_types").select("id, default_days_per_year")
  if (error) throw new Error(`Reading leave_types: ${error.message}`)

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

  check(
    "Seeding leave balances",
    await db.from("leave_balances").upsert(rows, {
      onConflict: "employee_id,leave_type_id,year",
      ignoreDuplicates: true,
    })
  )
  console.log("Seeded leave balances.")
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
      effective_from: employee.joining_date ?? new Date().toISOString().slice(0, 10),
    }
  })

  check(
    "Seeding salary structures",
    await db.from("salary_structures").upsert(rows, { onConflict: "employee_id", ignoreDuplicates: true })
  )
  console.log("Seeded salary structures.")
}

async function seedSampleProject(employees) {
  const { data: existing } = await db.from("projects").select("id").eq("name", "HRMS Platform").maybeSingle()
  if (existing) return

  const byFirstName = Object.fromEntries(employees.map((e) => [e.first_name, e]))
  const founder = employees.find((e) => e.role === "founder")
  const pm = employees.find((e) => e.role === "project_manager")
  if (!founder || !pm) return

  const { data: project, error } = await db
    .from("projects")
    .insert({
      name: "HRMS Platform",
      description: "Internal HR management system for Whhohh Path LLP.",
      tech_stack: ["React", "Supabase", "PostgreSQL"],
      priority: "high",
      status: "active",
      deadline: daysFromNow(60),
      progress: 35,
      created_by: founder.user_id,
    })
    .select("id")
    .single()
  if (error) throw new Error(`Creating sample project: ${error.message}`)

  const members = ["Ganesh", "Tarak", "Pavan"]
    .map((name) => byFirstName[name])
    .filter(Boolean)
    .map((employee) => ({ project_id: project.id, employee_id: employee.id, role_in_project: "Developer" }))
  check("Adding project members", await db.from("project_members").insert(members))

  const { data: tasks, error: taskError } = await db
    .from("tasks")
    .insert([
      {
        project_id: project.id,
        title: "Design database schema",
        description: "Model core HR entities and relationships.",
        assigned_to: byFirstName.Tarak?.id ?? null,
        priority: "high",
        due_date: daysFromNow(5),
        status: "completed",
        created_by: pm.user_id,
      },
      {
        project_id: project.id,
        title: "Build employee management UI",
        description: "List, profile, and edit screens for employees.",
        assigned_to: byFirstName.Pavan?.id ?? null,
        priority: "medium",
        due_date: daysFromNow(10),
        status: "in_progress",
        created_by: pm.user_id,
      },
    ])
    .select("id, title")
  if (taskError) throw new Error(`Creating sample tasks: ${taskError.message}`)

  const uiTask = tasks.find((t) => t.title === "Build employee management UI")
  check(
    "Adding checklist items",
    await db.from("task_checklist_items").insert([
      { task_id: uiTask.id, label: "List page", is_done: true },
      { task_id: uiTask.id, label: "Profile page", is_done: true },
      { task_id: uiTask.id, label: "Edit form", is_done: false },
    ])
  )

  console.log("Created sample project 'HRMS Platform' with tasks.")
}

async function seedContent(employees) {
  const founder = employees.find((e) => e.role === "founder")
  const hr = employees.find((e) => e.role === "hr_admin")

  const { data: existingPolicy } = await db.from("policies").select("id").eq("title", "Leave Policy").maybeSingle()
  if (founder && !existingPolicy) {
    check(
      "Seeding policies",
      await db.from("policies").insert([
        {
          title: "Leave Policy",
          content:
            "All employees are entitled to Casual, Sick, Paid, Work From Home and Comp Off leave as per " +
            "their leave balance. Leave requests should be submitted in advance via the Leaves module and " +
            "require HR approval.",
          updated_by: founder.user_id,
        },
        {
          title: "Code of Conduct",
          content:
            "Employees are expected to act with integrity, respect colleagues, and safeguard company and " +
            "client data. Violations should be reported to HR.",
          updated_by: founder.user_id,
        },
      ])
    )
    console.log("Seeded sample policies.")
  }

  const { data: existingAnnouncement } = await db
    .from("announcements")
    .select("id")
    .eq("title", "Welcome to the new HRMS")
    .maybeSingle()

  if (hr && !existingAnnouncement) {
    check(
      "Seeding announcements",
      await db.from("announcements").insert([
        {
          title: "Welcome to the new HRMS",
          body:
            "We've moved to a new in-house HR platform. Explore Attendance, Leaves, Projects, Tasks and " +
            "more from the sidebar.",
          category: "news",
          pinned: true,
          created_by: hr.user_id,
        },
        {
          title: "Office closed for Independence Day",
          body: "The office will remain closed on August 15th for Independence Day.",
          category: "holiday",
          pinned: false,
          created_by: hr.user_id,
        },
      ])
    )
    console.log("Seeded sample announcements.")
  }
}

async function main() {
  const departments = await lookup("departments", "name")
  const designations = await lookup("designations", "title")

  if (Object.keys(departments).length === 0) {
    throw new Error("No departments found — apply supabase/migrations/*.sql before seeding.")
  }

  await seedEmployees(departments, designations)

  const { data: rows, error } = await db
    .from("employees")
    .select("id, first_name, joining_date, user_id, users!inner(role_id, roles!inner(name))")
  if (error) throw new Error(`Reading employees: ${error.message}`)

  const employees = rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    joining_date: row.joining_date,
    user_id: row.user_id,
    role: row.users.roles.name,
  }))

  await seedLeaveBalances(employees)
  await seedSalaryStructures(employees)
  await seedSampleProject(employees)
  await seedContent(employees)

  console.log("Seed complete.")
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

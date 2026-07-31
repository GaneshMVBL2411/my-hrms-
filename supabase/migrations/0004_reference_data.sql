-- =============================================================================
-- 0004 — Reference data
--
-- The lookup rows the app cannot start without. Idempotent: safe to re-run.
-- People (and the demo project/policies/announcements that hang off them) are
-- seeded by supabase/seed.mjs instead, because creating a login needs the
-- service key and the Auth admin API.
-- =============================================================================

insert into roles (name, description) values
  ('founder',         'Full access to every module'),
  ('hr_admin',        'Manages people, payroll and documents'),
  ('project_manager', 'Manages projects and tasks'),
  ('team_lead',       'Manages tasks for their team'),
  ('employee',        'Self-service access')
on conflict (name) do nothing;

insert into permissions (code) values
  ('employees.manage'),
  ('employees.view'),
  ('projects.manage'),
  ('tasks.manage'),
  ('payroll.manage')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('founder',         'employees.manage'),
  ('founder',         'employees.view'),
  ('founder',         'projects.manage'),
  ('founder',         'tasks.manage'),
  ('founder',         'payroll.manage'),
  ('hr_admin',        'employees.manage'),
  ('hr_admin',        'employees.view'),
  ('project_manager', 'employees.view'),
  ('project_manager', 'projects.manage'),
  ('project_manager', 'tasks.manage'),
  ('team_lead',       'employees.view'),
  ('team_lead',       'tasks.manage'),
  ('employee',        'employees.view')
) as m(role_name, permission_code)
join roles r on r.name = m.role_name
join permissions p on p.code = m.permission_code
on conflict do nothing;

insert into departments (name) values
  ('Engineering'), ('Design'), ('AI/ML'), ('Operations')
on conflict (name) do nothing;

insert into designations (title) values
  ('Founder & CEO'), ('Software Engineer'), ('Product Designer'), ('AI Engineer'), ('HR Executive')
on conflict (title) do nothing;

insert into leave_types (name, default_days_per_year) values
  ('Casual Leave', 12),
  ('Sick Leave', 10),
  ('Paid Leave', 15),
  ('Work From Home', 24),
  ('Comp Off', 5)
on conflict (name) do nothing;

insert into company_settings (company_name, address)
select 'Whhohh Path LLP', 'Bengaluru, Karnataka, India'
where not exists (select 1 from company_settings);

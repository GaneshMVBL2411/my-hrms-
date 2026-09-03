-- ---------------------------------------------------------------------------
-- The employee directory shows colleagues, not their personal files.
--
-- What was wrong
--
-- `employee_directory` handed every column to every colleague: phone, home
-- address, date of birth and gender alongside the name and job title. The RLS
-- policy behind it is `company_id = app_company_id()`, which is the right rule
-- for "may I see that this person works here" and the wrong one for "may I see
-- where they live".
--
-- Nothing has leaked yet, and that is luck rather than design: no employee
-- record has a phone, address or date of birth filled in. The first time HR
-- completes one, it becomes readable by all seven staff.
--
-- What this does
--
-- The view keeps its column list — the frontend selects these names and must
-- go on working — but the personal ones now return null unless the row is your
-- own or you are HR. A directory anyone can browse, personal data only for the
-- person it belongs to and the people whose job it is.
--
--   everyone   name, employee code, work email, photo, department,
--              designation, reporting manager, skills, experience
--   self + HR  phone, address, date of birth, gender
--
-- Deliberately left visible to all: joining_date and status. Both are ordinary
-- workplace facts — who is here and since when — and the org chart already
-- implies them.
--
-- security_invoker stays on, so RLS still decides which rows are visible and
-- the company boundary is enforced exactly where it was before. A definer view
-- would have had to re-implement that scoping itself, which is a second place
-- for tenant isolation to be got wrong.
-- ---------------------------------------------------------------------------

create or replace view public.employee_directory as
select e.id,
       e.employee_code,
       e.full_name,
       u.email,
       -- Personal data: yours, or HR's business. `is_self` compares the row's
       -- user to the caller, not the employee id, because that is what the
       -- session actually carries.
       case when e.user_id = public.app_user_id() or public.app_is_hr() then e.phone end::varchar(20) as phone,
       case when e.user_id = public.app_user_id() or public.app_is_hr() then e.address end::varchar(500) as address,
       e.photo_url,
       e.department_id,
       d.name as department_name,
       e.designation_id,
       g.title as designation_title,
       e.status,
       e.joining_date,
       e.first_name,
       e.last_name,
       case when e.user_id = public.app_user_id() or public.app_is_hr() then e.dob end::date as dob,
       case when e.user_id = public.app_user_id() or public.app_is_hr() then e.gender end::public.gender_enum as gender,
       e.reporting_manager_id,
       m.full_name as reporting_manager_name,
       e.skills,
       e.experience_years,
       e.created_at
  from public.employees e
  join public.users u on u.id = e.user_id
  left join public.departments d on d.id = e.department_id
  left join public.designations g on g.id = e.designation_id
  left join public.employees m on m.id = e.reporting_manager_id;

alter view public.employee_directory set (security_invoker = true);
grant select on public.employee_directory to hrms_app;

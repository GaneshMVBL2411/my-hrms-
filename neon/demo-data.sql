-- ---------------------------------------------------------------------------
-- Demo data for Whhoohh Path LLP (company 1).
--
-- Why this exists: the dashboard was reporting zeros because there was almost
-- nothing to report — five attendance records spread over a month, two tasks,
-- one leave request. Every number on the page was correct and every one of them
-- looked broken. This fills the last three weeks in so the portal can be shown
-- to someone without that explanation attached.
--
-- Safe to re-run. Attendance relies on the (employee_id, date) unique
-- constraint and does nothing on conflict; leaves and tasks check for
-- themselves first. Nothing here updates or deletes an existing row, so real
-- data entered through the portal always wins over the demo.
--
-- Runs as the owner (DATABASE_URL_OWNER), which bypasses RLS — a seed has no
-- session to be scoped by. Every row still sets company_id explicitly, so what
-- lands is exactly what a company-scoped caller would be allowed to see.
--
-- To undo, see the delete statements at the foot of this file.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------- attendance
-- Three weeks of weekdays for all seven employees. The pattern is a hash of
-- the employee and the day of the year rather than random(), so re-running
-- produces the same history instead of a different one each time.
insert into public.attendance_records
  (employee_id, date, check_in, check_out, break_minutes, status, company_id)
select
  e.id,
  d::date,
  -- absences have no clock times at all
  case when v.roll in (0, 1) then null
       else d + time '09:00' + ((e.id * 13 + v.doy) % 55) * interval '1 minute'
  end,
  case
    when v.roll in (0, 1) then null
    -- today, a third of the team have not clocked out yet: they are still in
    when d::date = current_date and e.id % 3 = 0 then null
    when v.roll in (2, 3) then d + time '09:00' + ((e.id * 13 + v.doy) % 55) * interval '1 minute' + interval '4 hours'
    else d + time '09:00' + ((e.id * 13 + v.doy) % 55) * interval '1 minute'
         + interval '8 hours 45 minutes' + ((e.id * 7 + v.doy) % 40) * interval '1 minute'
  end,
  case when v.roll in (0, 1) then 0 else 30 + ((e.id + v.doy) % 20) end,
  case v.roll
    when 0 then 'on_leave'::attendance_status_enum
    when 1 then 'absent'::attendance_status_enum
    when 2 then 'half_day'::attendance_status_enum
    when 3 then 'half_day'::attendance_status_enum
    else        'present'::attendance_status_enum
  end,
  e.company_id
from generate_series(current_date - 20, current_date, interval '1 day') as d
cross join lateral (select extract(doy from d)::int as doy) as v0
cross join public.employees e
cross join lateral (select v0.doy, (e.id * 7 + v0.doy) % 20 as roll) as v
where e.company_id = 1
  and e.status = 'active'
  and extract(isodow from d) between 1 and 5   -- weekdays only
on conflict (employee_id, date) do nothing;

-- ----------------------------------------------------------------- leaves
-- A spread of states so the Leaves page has something to approve, something
-- already decided, and something turned down.
insert into public.leave_requests
  (employee_id, leave_type_id, start_date, end_date, days_count, reason, status, decided_by, decided_at, company_id)
select v.employee_id, v.leave_type_id, v.start_date, v.end_date, v.days_count, v.reason,
       v.status::leave_status_enum, v.decided_by, v.decided_at, 1
from (values
  (5, 2, current_date + 3,  current_date + 4,  2.0, 'Fever, seeing a doctor',            'pending',  null, null),
  (7, 1, current_date + 7,  current_date + 7,  1.0, 'Family function',                   'pending',  null, null),
  (3, 4, current_date - 5,  current_date - 5,  1.0, 'Working from home, plumber coming', 'approved', 2,    now() - interval '6 days'),
  (6, 3, current_date - 12, current_date - 10, 3.0, 'Short holiday',                     'approved', 2,    now() - interval '14 days'),
  (4, 1, current_date - 2,  current_date - 1,  2.0, 'Personal work',                     'rejected', 2,    now() - interval '3 days')
) as v(employee_id, leave_type_id, start_date, end_date, days_count, reason, status, decided_by, decided_at)
where not exists (
  select 1 from public.leave_requests lr
   where lr.employee_id = v.employee_id and lr.start_date = v.start_date
);

-- ------------------------------------------------------------------ tasks
-- Enough spread across the four statuses that the board and the dashboard
-- counters both have something to show.
insert into public.tasks
  (project_id, title, description, assigned_to, priority, due_date, status, progress, created_by, company_id)
select 1, v.title, v.description, v.assigned_to, v.priority::priority_enum, v.due_date,
       v.status::task_status_enum, v.progress, 2, 1
from (values
  ('Wire up payroll export',        'CSV for the accounts team, one row per payslip.', 3, 'high',   current_date + 2,  'in_progress', 60),
  ('Attendance report filters',     'Filter by department and date range.',            5, 'medium', current_date + 5,  'in_progress', 35),
  ('Leave approval notifications',  'Email the requester when a decision is made.',    4, 'high',   current_date + 1,  'review',      90),
  ('Asset handover checklist',      'Printable form for laptops and access cards.',    7, 'low',    current_date + 9,  'assigned',    0),
  ('Onboarding document pack',      'Offer letter, NDA and policy acknowledgement.',   2, 'medium', current_date + 6,  'assigned',    0),
  ('Fix payslip PDF margins',       'Footer overlaps the signature block.',            6, 'medium', current_date - 1,  'review',      80),
  ('Department headcount widget',   'Show joiners and leavers per month.',             3, 'low',    current_date + 12, 'assigned',    0),
  ('Migrate remaining seed scripts','Move the Supabase SQL over to the neon folder.',  4, 'medium', current_date - 4,  'completed',   100),
  ('Company bank details screen',   'Payout account plus statutory registrations.',    5, 'high',   current_date - 7,  'completed',   100),
  ('Role permission matrix review', 'Confirm what a team lead may and may not see.',   2, 'high',   current_date + 4,  'in_progress', 25)
) as v(title, description, assigned_to, priority, due_date, status, progress)
where not exists (select 1 from public.tasks t where t.title = v.title and t.company_id = 1);

-- ---------------------------------------------------------------------------
-- Undo. Removes only what this file adds, matched by the same keys it inserts
-- on. Run the three together — deleting tasks alone would leave the attendance
-- history behind.
--
--   delete from public.attendance_records
--    where company_id = 1 and date >= current_date - 20
--      and id not in (select id from public.attendance_records where created_at < '2026-08-27');
--
--   delete from public.leave_requests
--    where company_id = 1
--      and reason in ('Fever, seeing a doctor', 'Family function',
--                     'Working from home, plumber coming', 'Short holiday', 'Personal work');
--
--   delete from public.tasks
--    where company_id = 1 and title in (
--      'Wire up payroll export', 'Attendance report filters', 'Leave approval notifications',
--      'Asset handover checklist', 'Onboarding document pack', 'Fix payslip PDF margins',
--      'Department headcount widget', 'Migrate remaining seed scripts',
--      'Company bank details screen', 'Role permission matrix review');
-- ---------------------------------------------------------------------------

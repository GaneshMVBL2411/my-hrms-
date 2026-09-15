-- =============================================================================
-- Neon 0041 — Two more answers for server-initiated email
--
-- 0040 gave the mail hooks a way to see employees at all. Wiring the rest of
-- the hooks needs two things it did not provide:
--
--   * An offboarding mail goes to someone deactivate_employee has just set
--     is_active = false on. email_recipient refused inactive users — right
--     for every other mail, wrong for the one that says goodbye — so it now
--     takes a flag.
--   * A policy published to the company is addressed to each person by name,
--     and email_audience only knew addresses.
--
-- Both are return-type changes, which `create or replace` cannot make, so
-- the old shapes are dropped first. Nothing else references them yet.
-- =============================================================================

drop function if exists public.email_recipient(integer);
drop function if exists public.email_audience(integer);

create or replace function public.email_recipient(p_employee_id integer, p_include_inactive boolean default false)
returns table (email text, full_name text, company_id integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.email::text, e.full_name::text, e.company_id
    from employees e
    join users u on u.id = e.user_id
   where e.id = p_employee_id
     and (u.is_active or p_include_inactive)
   limit 1;
$$;

create or replace function public.email_audience(p_company_id integer)
returns table (email text, full_name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.email::text, coalesce(e.full_name, u.email)::text
    from users u
    left join employees e on e.user_id = u.id
   where u.company_id = p_company_id
     and u.is_active;
$$;

-- Who a task was created by, for the "task completed" mail back to them.
create or replace function public.email_user(p_user_id integer)
returns table (email text, full_name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.email::text, coalesce(e.full_name, u.email)::text
    from users u
    left join employees e on e.user_id = u.id
   where u.id = p_user_id
     and u.is_active
   limit 1;
$$;

revoke all on function public.email_recipient(integer, boolean) from public;
revoke all on function public.email_audience(integer) from public;
revoke all on function public.email_user(integer) from public;
grant execute on function public.email_recipient(integer, boolean) to hrms_app;
grant execute on function public.email_audience(integer) to hrms_app;
grant execute on function public.email_user(integer) to hrms_app;

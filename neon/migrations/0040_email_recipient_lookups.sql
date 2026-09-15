-- =============================================================================
-- Neon 0040 — Recipient lookups for server-initiated email
--
-- Every event email that goes to an employee — a leave decision, a welcome, a
-- payslip — looked its recipient up through `withoutSession`, as hrms_app with
-- no session variables set. Under row level security that connection sees no
-- employees and no users at all, so the lookup returned nothing and the hook
-- returned early: silently, because "no such employee" is not an error. Every
-- one of those emails was being skipped.
--
-- The lookups become SECURITY DEFINER functions, like get_email_branding and
-- log_email_attempt already are. Each answers exactly the question the hook
-- asks and nothing wider: one employee's address by id, a company's approvers,
-- a company's active mailboxes. None takes a filter from the caller beyond an
-- id the server already holds.
-- =============================================================================

create or replace function public.email_recipient(p_employee_id integer)
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
     and u.is_active
   limit 1;
$$;

create or replace function public.email_approvers(p_company_id integer)
returns table (email text, full_name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.email::text, coalesce(e.full_name, u.email)::text
    from users u
    join roles r on r.id = u.role_id
    left join employees e on e.user_id = u.id
   where u.company_id = p_company_id
     and u.is_active
     -- Base role, so a company-defined role built on hr_admin still approves.
     and coalesce(r.base_role, r.name) in ('founder', 'company_admin', 'hr_admin');
$$;

create or replace function public.email_audience(p_company_id integer)
returns table (email text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.email::text
    from users u
   where u.company_id = p_company_id
     and u.is_active;
$$;

revoke all on function public.email_recipient(integer) from public;
revoke all on function public.email_approvers(integer) from public;
revoke all on function public.email_audience(integer) from public;
grant execute on function public.email_recipient(integer) to hrms_app;
grant execute on function public.email_approvers(integer) to hrms_app;
grant execute on function public.email_audience(integer) to hrms_app;

-- =============================================================================
-- Neon 0016 — The profile reflects the company being supported
--
-- current_user_profile() joined companies on users.company_id. For a platform
-- admin that is null by definition, so during a support session the client was
-- told it had no company at all: the banner read "You are inside" with a blank
-- where the name should be, the sidebar showed the platform label, and no brand
-- colours were applied.
--
-- The session already resolves to the right tenant everywhere else —
-- app_company_id() returns it, RLS honours it, the data comes back correctly.
-- Only the profile disagreed, which is the one place a person actually looks to
-- see where they are.
--
-- Resolved through app_company_id() instead, which is the same answer every
-- policy uses. One definition of "which company am I in", not two.
-- =============================================================================

create or replace function public.current_user_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'role', r.name,
    'full_name', coalesce(e.full_name, u.email),
    'employee_id', e.id,
    'photo_url', e.photo_url,
    -- The user's own company, unchanged: a platform admin still has none, and
    -- the client uses this to decide whether to show the console.
    'company_id', u.company_id,
    -- What the session currently resolves to. During a support session this is
    -- the customer's, which is what the banner and the branding should show.
    'company_name', c.name,
    'company_code', c.code,
    'company_logo_url', c.logo_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'accent_color', c.accent_color,
    'is_super_admin', public.app_is_platform_user(),
    'modules', coalesce(
      (select jsonb_agg(m.module order by m.module)
       from company_modules m
       where m.company_id = public.app_company_id() and m.is_enabled),
      '[]'::jsonb
    ),
    'support_company_id', (
      select s.company_id from support_sessions s
      where s.super_admin_user_id = u.id and s.ended_at is null
      order by s.started_at desc limit 1
    )
  )
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  -- app_company_id(), not u.company_id: for an ordinary user they are the same,
  -- and for a platform admin in support mode this is the company they entered.
  left join companies c on c.id = public.app_company_id()
  where u.id = public.app_user_id() and u.is_active
$$;


-- ------------------------------------------------------------- diagnostics
select
  pg_get_functiondef(p.oid) ilike '%c.id = public.app_company_id()%' as joins_on_session_company,
  pg_get_functiondef(p.oid) ilike '%app_is_platform_user%'           as uses_identity_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'current_user_profile';

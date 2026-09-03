-- =============================================================================
-- Neon 0010 — Brand colours in the session profile
--
-- current_user_profile() is what the client reads on sign-in to decide who the
-- user is and what to show them. Adding the tenant's colours here means the app
-- can theme itself from the one request it already makes, rather than fetching
-- the company row separately on every load.
--
-- Null colours are expected and handled: the client falls back to the platform
-- palette, which is what every screen rendered before tenants had identities.
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
    'company_id', u.company_id,
    'company_name', c.name,
    'company_code', c.code,
    'company_logo_url', c.logo_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'accent_color', c.accent_color,
    'is_super_admin', (u.company_id is null and r.name = 'super_admin'),
    'modules', coalesce(
      (select jsonb_agg(m.module order by m.module)
       from company_modules m
       where m.company_id = u.company_id and m.is_enabled),
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
  left join companies c on c.id = u.company_id
  where u.id = public.app_user_id() and u.is_active
$$;


-- ------------------------------------------------------------- diagnostics
select c.name, c.code, c.primary_color, c.secondary_color, c.accent_color, c.logo_url
from public.companies c order by c.id;

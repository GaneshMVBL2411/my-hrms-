-- Roles a company defines for itself, without weakening what a role means.
--
-- The Add Employee form offered five roles and no way to add one. A company
-- with recruiters, or auditors, or a title HR simply prefers, had to choose
-- the nearest built-in and live with the wrong word on every screen.
--
-- WHY A CUSTOM ROLE IS TWO THINGS AND NOT ONE
--
-- A role here is not a label. It is the permission model: app_is_hr() asks
-- whether app_role() is one of three names, and every policy in the schema
-- goes through those helpers. So a row that is only a name means nothing to
-- the database, and a company that could insert arbitrary names could just as
-- easily insert 'founder'.
--
-- A company-defined role therefore carries two facts: what it is called, and
-- which built-in role it grants the permissions of. The name is for people.
-- The base is for the database, and it is the only part the security model
-- ever reads. app_role() returns the base, so no helper, policy or check
-- anywhere else has to learn that custom roles exist.
--
-- WHAT A COMPANY MAY BASE A ROLE ON
--
-- The same set HR may already assign directly: hr_admin, project_manager,
-- team_lead, employee. Not founder, not company_admin, not super_admin. A
-- custom role is a name for a permission level HR could already hand out; it
-- is not a way to hand out one they could not.

alter table public.roles
  add column if not exists company_id integer references public.companies(id) on delete cascade,
  add column if not exists base_role  varchar(40);

-- Either a system role (no company, no base) or a company role (both). A row
-- with one and not the other is a mistake and is refused as one.
alter table public.roles drop constraint if exists roles_scope_consistent;
alter table public.roles add constraint roles_scope_consistent check (
  (company_id is null and base_role is null)
  or (company_id is not null and base_role in ('hr_admin', 'project_manager', 'team_lead', 'employee'))
);

-- Unique within a company, case-insensitively. Two companies may both have a
-- "Recruiter"; one company may not have two.
create unique index if not exists ux_roles_company_name
  on public.roles (company_id, lower(name))
  where company_id is not null;

-- A company may read the system roles and its own. Not another company's:
-- role names are as much a part of a tenant as its employee names.
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles
  for select
  using (
    (select public.app_is_hr())
    and (company_id is null or company_id = (select public.app_company_id()))
  );

/**
 * The permissions a caller acts with.
 *
 * For a system role that is its name. For a company-defined role it is the
 * base role, which is the whole reason this function exists as a seam: every
 * helper and every policy reads through here, so custom roles resolve to
 * built-in permissions everywhere without any of them changing.
 */
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(r.base_role, r.name)
    from users u
    join roles r on r.id = u.role_id
   where u.id = public.app_user_id() and u.is_active
$$;

-- The session carries the effective role too, so the server and the client
-- make the same decisions the database does. The label travels separately.
CREATE OR REPLACE FUNCTION public.authenticate(p_email text, p_password text)
 RETURNS TABLE(user_id integer, email text, company_id integer, role text, employee_id integer, is_active boolean, email_confirmed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    u.id,
    u.email::text,
    u.company_id,
    coalesce(r.base_role, r.name)::text,
    e.id,
    u.is_active,
    u.email_confirmed_at is not null
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where lower(u.email) = lower(p_email)
    -- The password is checked inside the function, so a caller that guesses
    -- wrong learns nothing at all â€” not even whether the address exists.
    and u.password_hash is not null
    and u.password_hash = crypt(p_password, u.password_hash)
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_session(p_user_id integer)
 RETURNS TABLE(user_id integer, email text, company_id integer, role text, employee_id integer, support_company_id integer, password_changed_at timestamp with time zone, token_version integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    u.id,
    u.email::text,
    u.company_id,
    coalesce(r.base_role, r.name)::text,
    e.id,
    (select s.company_id
       from support_sessions s
      where s.super_admin_user_id = u.id and s.ended_at is null
      order by s.started_at desc
      limit 1),
    u.password_changed_at,
    coalesce(u.token_version, 1)
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where u.id = p_user_id and u.is_active
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_profile()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'role', coalesce(r.base_role, r.name),
    -- What the role is called, which for a company-defined role differs from
    -- what it does. The client shows this and decides with the one above.
    'role_label', r.name,
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_employee_role(p_employee_id integer, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role_id integer;
  v_target_user_id integer;
  v_caller_user_id integer := public.app_user_id();
  v_caller_role text;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- Block minting super_admin from inside a tenant
  if p_role = 'super_admin' then
    raise exception 'super_admin cannot be assigned from within a company' using errcode = '42501';
  end if;

  select e.user_id into v_target_user_id
    from employees e
   where e.id = p_employee_id
     and e.company_id = public.app_company_id();

  if v_target_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  -- H4: Prevent changing your own privileged role
  if v_target_user_id = v_caller_user_id then
    raise exception 'You cannot modify your own role' using errcode = '42501';
  end if;

  -- H4: Only an existing founder (or super_admin) can assign the founder role
  if p_role = 'founder' then
    select r.name into v_caller_role
      from users u
      join roles r on r.id = u.role_id
     where u.id = v_caller_user_id;

    if v_caller_role <> 'founder' and not public.app_is_super_admin() then
      raise exception 'Only an existing founder can assign the founder role' using errcode = '42501';
    end if;
  end if;

  -- A system role by name, or one this company defined. Never another
  -- company's: a role is scoped to the tenant that created it, and resolving
  -- across tenants would let one company's label pick another's definition.
  select id into v_role_id
    from roles
   where lower(name) = lower(p_role)
     and (company_id is null or company_id = public.app_company_id())
   order by company_id nulls last
   limit 1;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  update users set role_id = v_role_id where id = v_target_user_id;

  -- H5: Mandatory compliance audit logging
  perform public.log_security_event(
    'role.assigned',
    'employees',
    p_employee_id,
    jsonb_build_object('new_role', p_role, 'assigned_by', v_caller_user_id)
  );
end;
$function$
;

/**
 * Defines a role for the caller's company.
 *
 * HR only, and only on a base HR could already assign. The name may not be a
 * system role's, in any case: a company "Founder" that grants employee-level
 * access would mislead every screen that shows it.
 */
create or replace function public.create_company_role(p_name text, p_base_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_name    text    := btrim(p_name);
  v_row     roles%rowtype;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if v_company is null then
    raise exception 'A role belongs to a company' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 40 then
    raise exception 'A role name is between 2 and 40 characters' using errcode = 'P0001';
  end if;
  if p_base_role not in ('hr_admin', 'project_manager', 'team_lead', 'employee') then
    raise exception 'A role can be based on hr_admin, project_manager, team_lead or employee'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from roles where company_id is null and lower(name) = lower(v_name)) then
    raise exception '"%" is a built-in role', v_name using errcode = 'P0001';
  end if;
  if exists (select 1 from roles where company_id = v_company and lower(name) = lower(v_name)) then
    raise exception 'This company already has a role called "%"', v_name using errcode = 'P0001';
  end if;

  insert into roles (name, description, company_id, base_role)
  values (v_name, 'Defined by the company', v_company, p_base_role)
  returning * into v_row;

  perform public.log_security_event(
    'role.created', 'roles', v_row.id,
    jsonb_build_object('name', v_name, 'base_role', p_base_role)
  );

  return jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'base_role', v_row.base_role, 'is_custom', true
  );
end;
$$;

/**
 * The roles the caller may assign: the built-ins HR can hand out, and the
 * company's own. founder is included only for a founder, matching the gate in
 * set_employee_role, so the form does not offer a choice that will be refused.
 */
create or replace function public.list_assignable_roles()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'name', r.name,
           'description', r.description,
           'base_role', r.base_role,
           'is_custom', r.company_id is not null
         ) order by r.company_id nulls first, r.id), '[]'::jsonb)
    from roles r
   where public.app_is_hr()
     and (
       (r.company_id is null
         and (r.name in ('hr_admin', 'project_manager', 'team_lead', 'employee')
              or (r.name = 'founder' and public.app_is_founder())))
       or r.company_id = public.app_company_id()
     )
$$;

revoke all on function public.create_company_role(text, text) from public;
revoke all on function public.list_assignable_roles() from public;
grant execute on function public.create_company_role(text, text) to hrms_app;
grant execute on function public.list_assignable_roles() to hrms_app;

-- ------------------------------------------------------------- diagnostics
select count(*) filter (where company_id is null) as system_roles,
       count(*) filter (where company_id is not null) as company_roles
  from public.roles;

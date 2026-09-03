-- ---------------------------------------------------------------------------
-- Put the password hashes out of the application role's reach.
--
-- The API already refuses to read `users` through /query, which closes the way
-- an employee was listing every colleague's bcrypt hash. This is the second
-- lock: even a query that got past the endpoint — a future handler, an RPC
-- written without this in mind, a SQL injection that survived the identifier
-- checks — cannot select the column, because the role the server connects as no
-- longer holds the privilege.
--
-- Why this does not break signing in
--
-- Every function that reads or writes password_hash is SECURITY DEFINER, so it
-- executes as the table's owner rather than as hrms_app and is unaffected:
--
--   authenticate               verifies a password at sign-in
--   set_own_password           changing your own
--   set_employee_password      HR resetting someone's
--   create_employee_with_login creating an account
--
-- No view selects the column either, so nothing else loses a read it depended
-- on. Both facts were checked against the live database before this was
-- written, not assumed.
--
-- Postgres has no way to subtract one column from a table-level grant, so the
-- table grant is dropped and re-issued per column. The list is built at run
-- time from the catalogue, which keeps this correct for the schema as it stands
-- when applied — but it does mean a column added to `users` later will NOT be
-- readable until this is re-run. That is the maintenance cost of the lock, and
-- it is worth naming rather than discovering.
-- ---------------------------------------------------------------------------

-- Both roles, and the second one is the whole point.
--
-- Revoking from hrms_app alone changed the ACL and achieved nothing:
--
--   hrms_app=awd        SELECT removed, correctly
--   authenticated=rw    ...but this still had it
--
-- hrms_app is a member of `authenticated` — a role left over from Supabase —
-- and inherits its privileges. has_column_privilege still answered true, so the
-- hash was as readable as before. A grant removed from one role is worth
-- nothing while another role the first belongs to still holds it, which is the
-- kind of thing that looks fixed in the migration and is not fixed in the
-- database.
do $$
declare
  v_cols text;
  v_role text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'users'
     and column_name <> 'password_hash';

  if v_cols is null then
    raise exception 'public.users has no columns — refusing to change grants';
  end if;

  foreach v_role in array array['hrms_app', 'authenticated']
  loop
    -- Skipped rather than failed if the role is absent, so this still applies
    -- to a database that never carried the Supabase roles.
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke select on public.users from %I', v_role);
      execute format('grant select (%s) on public.users to %I', v_cols, v_role);
    end if;
  end loop;

  -- Writes are deliberately untouched. hrms_app never sets a password directly
  -- either — the definer functions above do — but narrowing UPDATE here would
  -- risk the ordinary profile edits that do go through the role, for no gain
  -- against the threat this addresses, which is reading hashes out.
end
$$;

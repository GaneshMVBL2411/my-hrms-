-- ---------------------------------------------------------------------------
-- Make the audit trail append-only in fact, not just in intention.
--
-- The schema revoked update and delete on audit_logs from `authenticated`, and
-- that revoke is still in force. But `finalize-neon.ts` grants
--
--   grant select, insert, update, delete on all tables in schema public to hrms_app
--
-- and hrms_app is the role the API actually connects as. So the application
-- could rewrite or delete any audit row, including the record of whatever it
-- had just done. Tested before writing this: an UPDATE as hrms_app succeeded.
--
-- ISO/IEC 27001 A.8.15 asks that logs be protected against tampering, and an
-- audit trail the audited party can edit is not evidence of anything. The
-- application only ever needs to append to this table and, for HR, read it.
--
-- The blanket grant will re-apply this privilege if finalize-neon is ever run
-- again, so this revoke has to be re-run after it. That coupling is the real
-- defect; it is recorded in docs/iso27001-controls.md rather than left to be
-- rediscovered.
-- ---------------------------------------------------------------------------

revoke update, delete on public.audit_logs from hrms_app;

-- Belt and braces: the same for the roles that inherit into hrms_app.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke update, delete on public.audit_logs from authenticated';
  end if;
end
$$;

do $$
begin
  if has_table_privilege('hrms_app', 'public.audit_logs', 'UPDATE')
     or has_table_privilege('hrms_app', 'public.audit_logs', 'DELETE') then
    raise exception 'audit_logs is still modifiable by hrms_app';
  end if;
  if not has_table_privilege('hrms_app', 'public.audit_logs', 'INSERT')
     or not has_table_privilege('hrms_app', 'public.audit_logs', 'SELECT') then
    raise exception 'audit_logs must remain insertable and readable by hrms_app';
  end if;
end
$$;

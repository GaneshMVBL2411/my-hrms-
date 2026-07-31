-- =============================================================================
-- 0006 — Let service_role create employees
--
-- 0003 revoked EXECUTE on create_employee_profile from PUBLIC to keep it away
-- from browser sessions. service_role only ever held that privilege *through*
-- PUBLIC, so the revoke locked out the seed script and the admin-users Edge
-- Function as well — both authenticate as service_role. Symptom: seeding fails,
-- and "Add Employee" returns "permission denied for function".
--
-- 0003 now carries this grant too, so a fresh install never hits the problem.
-- This file exists to repair a database that already ran the earlier 0003:
-- run it on its own, it is idempotent and touches nothing else.
-- =============================================================================

grant execute on function public.create_employee_profile(uuid, text, text, jsonb) to service_role;

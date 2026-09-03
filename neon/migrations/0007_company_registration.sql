-- =============================================================================
-- Neon 0007 — Company registration date
--
-- A company has a date it legally came into existence, and the HRMS had nowhere
-- to record it. It matters beyond record-keeping: nobody can be employed before
-- the company exists, so this is the earliest a joining date or a payslip can
-- reasonably be.
--
-- Nullable, because companies already in the system were created without it and
-- backfilling a guess would be worse than leaving it unknown.
-- =============================================================================

alter table public.companies
  add column if not exists registered_on date;

comment on column public.companies.registered_on is
  'The date the company was legally registered. No employment predates it.';


-- ------------------------------------------------------------- diagnostics
select id, name, code, registered_on from public.companies order by id;

-- =============================================================================
-- Clear the stale payslips so they can be regenerated at current salaries
--
-- Run this whole file in the Supabase SQL Editor, as the `postgres` role.
--
-- Why this is a file you paste: `payslips` has insert/update/delete revoked from
-- `authenticated` (0002), so no browser session — not even HR — can remove a
-- payslip. And `generate_payslip` refuses to write one when a row already exists
-- for that employee and month, so the stale rows have to go before new ones can
-- be created. Deleting is the only step that needs privilege; regenerating runs
-- through the app as HR.
--
-- What is stale: every payslip for Jul/Aug/Sep 2026 was generated from the
-- original seed salaries (50k/60k/75k/90k) and none of them reflect the current
-- structures. The founder's three are the exception — his structure was restored
-- to its original figures, so his payslips already compute correctly — but they
-- are cleared too so all three months regenerate as one consistent set.
--
-- This deletes payslips only. Salary structures, employees and leave are all
-- untouched, and the payslips regenerate from `salary_structures`, so nothing
-- here is unrecoverable.
-- =============================================================================

-- What is about to be deleted, for the record. Compare it against the summary
-- printed at the end.
select
  p.year,
  p.month,
  e.full_name,
  p.basic,
  p.gross_pay,
  p.net_pay
from public.payslips p
join public.employees e on e.id = p.employee_id
where (p.year, p.month) in ((2026, 1), (2026, 8), (2026, 9))
order by p.year, p.month, p.employee_id;


delete from public.payslips
where (year, month) in ((2026, 1), (2026, 8), (2026, 9));


-- ------------------------------------------------------------- diagnostics
-- Expect zero rows. Once this is clear, the payslips can be regenerated for
-- each month from the current salary structures.
select count(*) as payslips_remaining from public.payslips;

-- The figures each regenerated payslip will carry, straight from the current
-- structures. Net = gross - PF - ESI - professional tax (200 above 15,000).
select
  e.full_name,
  s.basic,
  s.basic + s.hra + s.special_allowance                                   as gross_pay,
  round(s.basic * s.pf_percent / 100, 2)                                  as pf,
  round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2) as esi,
  case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end as professional_tax,
  round(
    (s.basic + s.hra + s.special_allowance)
    - round(s.basic * s.pf_percent / 100, 2)
    - round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2)
    - case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end,
    2
  ) as net_pay
from public.salary_structures s
join public.employees e on e.id = s.employee_id
order by s.employee_id;

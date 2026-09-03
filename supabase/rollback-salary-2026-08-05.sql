-- =============================================================================
-- Rollback: restore the salary structures as they stood on 2026-08-05
--
-- Run this whole file in the Supabase SQL Editor to undo the revision that set
-- every non-founder to a basic of 25,000.
--
-- These are the exact values read from salary_structure_detail immediately
-- before the change, including the original effective_from dates (which the
-- revision overwrote with the date it was applied). The founder's row was not
-- touched by the revision and is restored here only so the file is a complete
-- picture of that moment.
--
-- Safe to re-run; it sets absolute values rather than applying a delta.
--
-- Note: payslips are unaffected either way. The 18 rows for Jul/Aug/Sep 2026
-- store their own amounts and were deliberately left alone, so they already
-- reflect the pre-revision pay.
-- =============================================================================

update public.salary_structures s
set basic             = v.basic,
    hra               = v.hra,
    special_allowance = v.special_allowance,
    pf_percent        = v.pf_percent,
    esi_percent       = v.esi_percent,
    effective_from    = v.effective_from
from (values
  -- employee_id, basic,  hra,   special, pf,  esi,  effective_from
  (1, 150000.00, 60000.00, 22500.00, 12.00, 0.75, date '2021-01-01'),  -- Ravi Shanker (founder)
  (2,  60000.00, 24000.00,  9000.00, 12.00, 0.75, date '2022-03-15'),  -- Bhavya Sri
  (3,  90000.00, 36000.00, 13500.00, 12.00, 0.75, date '2022-06-01'),  -- Ganesh
  (4,  75000.00, 30000.00, 11250.00, 12.00, 0.75, date '2022-09-12'),  -- Tarak
  (5,  50000.00, 20000.00,  7500.00, 12.00, 0.75, date '2023-02-20'),  -- Pavan
  (6,  50000.00, 20000.00,  7500.00, 12.00, 0.75, date '2023-11-03')   -- Avinash
) as v(employee_id, basic, hra, special_allowance, pf_percent, esi_percent, effective_from)
where s.employee_id = v.employee_id;


-- ------------------------------------------------------------- diagnostics
select
  d.employee_id,
  d.employee_name,
  d.basic,
  d.hra,
  d.special_allowance,
  d.basic + d.hra + d.special_allowance as gross,
  d.effective_from
from public.salary_structure_detail d
order by d.employee_id;

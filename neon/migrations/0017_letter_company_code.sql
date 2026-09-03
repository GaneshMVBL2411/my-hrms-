-- letter_payload gains the company code, so the reference line reads
-- PRZ/HR/OFR/2026/001 for Prozonic rather than borrowing another tenant's
-- prefix. It already resolved the company; only the field was missing.
create or replace function public.letter_payload(p_letter_id integer)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', l.id, 'letter_type', l.letter_type,
    'employee_name', e.full_name, 'employee_code', e.employee_code,
    'employee_address', e.address, 'designation_title', g.title,
    'department_name', d.name, 'joining_date', e.joining_date,
    'reporting_manager_name', m.full_name,
    'annual_ctc', coalesce(l.annual_ctc_override,
                    (select c2.gross_pay * 12 from public.compute_payslip(e.id) c2)),
    'probation_text', coalesce(l.probation_text, 'Six months from the date of joining'),
    'notice_period_text', coalesce(l.notice_period_text, 'Thirty days on either side after confirmation'),
    'custom_message', l.custom_message,
    'company_name', co.name, 'company_address', co.address, 'company_code', co.code,
    'today', (now() at time zone 'utc')::date, 'generated_at', l.generated_at
  ) into v_result
  from generated_letters l
  join employees e on e.id = l.employee_id
  join companies co on co.id = l.company_id
  left join departments d on d.id = e.department_id
  left join designations g on g.id = e.designation_id
  left join employees m on m.id = e.reporting_manager_id
  where l.id = p_letter_id and l.company_id = public.app_company_id();
  return v_result;
end;
$$;
select 'letter_payload now returns company_code' as note;

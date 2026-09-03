-- =============================================================================
-- Neon 0018 — Correct the company's legal name
--
-- The database held "Whhohh Path LLP" (single o). The Word letterhead
-- templates, the logo and the email domain whhoohhpath.com all use "Whhoohh"
-- (double o), so the database was the odd one out.
--
-- Changed in `companies.name` and in the tenant's own settings row. Every
-- letter, payslip and screen reads from there, so nothing else needs touching.
--
-- Deliberately NOT changed: user email addresses. They are login credentials —
-- hr@whhohhpath.com and the rest — and rewriting them would lock everyone out.
-- Whether the mailbox domain itself should be corrected is a decision for
-- whoever owns the DNS, not something to infer from a template.
-- =============================================================================

update public.companies
   set name = 'Whhoohh Path LLP'
 where code = 'WPL' and name <> 'Whhoohh Path LLP';

update public.company_settings
   set company_name = 'Whhoohh Path LLP'
 where company_id = (select id from public.companies where code = 'WPL')
   and company_name <> 'Whhoohh Path LLP';


-- ------------------------------------------------------------- diagnostics
select c.id, c.name, c.code,
       (select s.company_name from public.company_settings s where s.company_id = c.id) as settings_name
from public.companies c
order by c.id;

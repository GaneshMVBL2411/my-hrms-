-- ---------------------------------------------------------------------------
-- Correct the email domain: whhohhpath.com -> whhoohhpath.com
--
-- Migration 0018 fixed the company's name to "Whhoohh Path LLP" (double o) and
-- said in as many words that the email domain is whhoohhpath.com. It did not
-- fix the addresses, so six sign-in identities were left on the misspelled
-- domain — the database disagreeing with itself, and with the letterhead, the
-- logo and Kalyani's own address, which already reads "whhoohh".
--
-- These are login identities, not display text: `authenticate()` matches on
-- lower(email), so this changes what six people type to sign in. Their
-- passwords are untouched.
--
-- Scoped by domain rather than by a list of ids: whhoohhpath.com addresses that
-- are already correct do not match, and the other three accounts
-- (admin@hrms.platform, admin@prozonic.com, kalyani...@gmail.com) are on
-- entirely different domains and are left alone.
--
-- Deliberately NOT touched: audit_logs.meta holds 60 rows quoting these
-- addresses as they were at the time. That is a record of what happened, and
-- rewriting history to make it tidy is the one thing an audit trail must never
-- allow. The old spelling in those rows is correct *as history*.
-- ---------------------------------------------------------------------------

update public.users
   set email = replace(email, '@whhohhpath.com', '@whhoohhpath.com')
 where email like '%@whhohhpath.com';

-- The employee directory reads users.email through a join, so it follows
-- automatically; there is no second copy of the address to keep in step.

do $$
declare
  v_left integer;
begin
  select count(*) into v_left from public.users where email like '%@whhohhpath.com';
  if v_left > 0 then
    raise exception 'Still % address(es) on the misspelled domain', v_left;
  end if;
end
$$;

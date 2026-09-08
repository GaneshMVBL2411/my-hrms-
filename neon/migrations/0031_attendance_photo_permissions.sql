-- Let an employee store the selfie taken at their own check-in, and stop
-- everyone else reading it.
--
-- 0004 gave files two policies, both written for what the table held at the
-- time — employee photos and company logos, uploaded by HR:
--
--   files_read   any signed-in member of the company may read any file
--   files_write  only app_is_hr() may write, i.e. founder, company_admin or
--                hr_admin
--
-- The attendance selfie broke both assumptions and neither was revisited. A
-- project manager punching in is not HR, so the insert was refused with "new
-- row violates row-level security policy for table files" and the punch was
-- lost with it. This never surfaced before because the API's 100kb body limit
-- rejected a photo long before it reached the database; fixing that limit is
-- what exposed this.
--
-- Widening files_write to everyone would be the wrong repair: it would let any
-- employee write any file anywhere in their company's namespace. The insert
-- allowed here is exactly one shape — a photo of yourself, in your own folder,
-- stamped with your own id — and nothing else about the table changes.

-- An employee may add their own attendance photo, and only that.
--
-- Deliberately insert-only. These rows are evidence attached to an attendance
-- record: whoever may create one may not then go back and alter or remove it,
-- so there is no `for all` here and no update or delete counterpart.
drop policy if exists files_attendance_insert on public.files;
create policy files_attendance_insert on public.files
  for insert to authenticated
  with check (
    company_id = (select public.app_company_id())
    and uploaded_by = (select public.app_user_id())
    -- Pinned to the caller's own id, so this cannot be used to write into
    -- someone else's folder, or anywhere outside attendance/.
    and path like 'attendance/' || (select public.app_user_id()) || '/%'
  );

/**
 * A colleague may not look at your check-in photographs.
 *
 * files_read was written when every file was something already on display —
 * the photo in the employee directory, the company logo. An attendance selfie
 * is not that: it is a picture of a person's face with a time and a place
 * attached, and "any signed-in member of the company" is far too wide a
 * readership for it.
 *
 * Restrictive rather than permissive, so it narrows files_read instead of
 * adding to it: a file outside attendance/ is unaffected, and one inside it is
 * readable only by the person in it or by HR, who are the ones reviewing
 * attendance in the first place.
 */
drop policy if exists files_attendance_private on public.files;
create policy files_attendance_private on public.files
  as restrictive
  for select to authenticated
  using (
    path not like 'attendance/%'
    or (select public.app_is_hr())
    or path like 'attendance/' || (select public.app_user_id()) || '/%'
  );

-- ------------------------------------------------------------- diagnostics
select polname, polcmd, polpermissive
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
 where c.relname = 'files'
 order by polname;

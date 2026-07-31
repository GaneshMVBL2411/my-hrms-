-- =============================================================================
-- 0005 — File storage
--
-- Employee photos used to be proxied through `POST /employees/{id}/photo` with
-- the service key. The browser now uploads straight to Storage, so the write
-- rules move into policies on storage.objects.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('hrms-files', 'hrms-files', true)
on conflict (id) do update set public = true;

-- Public read: photo_url / logo_url are plain URLs rendered by <img>, and are
-- already handed out to every signed-in user through the employee directory.
create policy "hrms_files_public_read"
on storage.objects for select
to public
using (bucket_id = 'hrms-files');

create policy "hrms_files_authenticated_write"
on storage.objects for insert
to authenticated
with check (bucket_id = 'hrms-files');

create policy "hrms_files_authenticated_update"
on storage.objects for update
to authenticated
using (bucket_id = 'hrms-files')
with check (bucket_id = 'hrms-files');

create policy "hrms_files_hr_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'hrms-files' and public.app_is_hr());

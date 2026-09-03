-- =============================================================================
-- Neon 0004 — File storage
--
-- Replaces the Supabase Storage bucket. Employee photos and company logos now
-- live in Postgres and are served by the API, so nothing outside Neon holds
-- HRMS data.
--
-- WHY THIS IS A REASONABLE PLACE FOR THEM, AND WHERE IT STOPS BEING ONE
--
-- These are small images — a photo is tens of kilobytes — and there are as many
-- of them as there are employees. At that size, bytea in Postgres is simpler
-- than a second service: one backup covers everything, one set of policies
-- governs access, and there is no bucket whose permissions can drift out of
-- step with the database's.
--
-- It stops being reasonable at scale. Large files, or many thousands of them,
-- bloat the database and every backup of it, and Postgres gives you no CDN.
-- If this ever grows to hold attachments or documents in bulk, move it to
-- object storage and keep only the metadata here.
--
-- SECURITY NOTE
--
-- The Supabase bucket this replaces was created `public = true` with a policy
-- granting select to `public` — meaning anonymous readers. Every employee photo
-- and generated letter was readable by anyone holding a URL, signed in or not.
-- That is not reproduced here: reads go through the API, which authenticates
-- first, and the policies below scope every file to its tenant.
-- =============================================================================

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  company_id integer not null references companies (id) on delete cascade,

  -- Mirrors the old bucket layout ("employees/3/photo.jpg") so existing
  -- photo_url values can be rewritten mechanically rather than re-derived.
  path varchar(500) not null,

  mime_type varchar(100) not null,
  size_bytes integer not null,
  data bytea not null,

  uploaded_by integer references users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint uq_files_company_path unique (company_id, path)
);

create index if not exists ix_files_company on files (company_id);

alter table files enable row level security;

drop policy if exists files_read  on files;
drop policy if exists files_write on files;

-- Any signed-in member of the company may read its files: a photo appears in
-- the employee directory, which everyone can already see.
create policy files_read on files
  for select to authenticated
  using (company_id = (select public.app_company_id()));

-- Writing is HR's job — the same people who may edit an employee.
create policy files_write on files
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

grant select, insert, update, delete on public.files to hrms_app;


-- ------------------------------------------------------------- diagnostics
select
  (select count(*) from public.files) as files,
  (select count(*) from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'files') as policies;

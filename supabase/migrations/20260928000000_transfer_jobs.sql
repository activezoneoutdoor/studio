-- Drive → Google Photos transfer state. Edge Functions write with the service role;
-- signed-in @activezoneoutdoor.cy operators may read jobs, items and albums.

create or replace function public.is_azo_operator()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(lower(auth.jwt()->>'email') ~ '@activezoneoutdoor\.cy$', false);
$$;

-- Singleton holding the photos@ account's Google refresh token. No policies: service role only.
create table public.google_connection (
  id boolean primary key default true check (id),
  email text not null,
  refresh_token text not null,
  scopes text not null,
  log_spreadsheet_id text,
  connected_at timestamptz not null default now()
);
alter table public.google_connection enable row level security;
revoke all on public.google_connection from anon, authenticated;

-- Drive folder → app-created Google Photos album.
create table public.photo_albums (
  drive_folder_id text primary key,
  album_id text not null unique,
  title text not null,
  product_url text,
  created_at timestamptz not null default now(),
  last_transfer_at timestamptz
);

create table public.transfer_jobs (
  id uuid primary key default gen_random_uuid(),
  drive_folder_id text not null,
  folder_name text not null,
  album_title text not null,
  album_id text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  operator_email text not null,
  items_total int not null default 0,
  items_done int not null default 0,
  items_skipped int not null default 0,
  items_failed int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index transfer_jobs_one_running_per_folder
  on public.transfer_jobs (drive_folder_id) where status = 'running';
create index transfer_jobs_started_at on public.transfer_jobs (started_at desc);

create table public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.transfer_jobs (id) on delete cascade,
  drive_file_id text not null,
  name text not null,
  mime_type text not null,
  size bigint not null default 0,
  md5 text,
  -- Already in the album (same Drive file or same checksum): trashed without uploading.
  duplicate boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'uploading', 'uploaded', 'trashed', 'skipped', 'failed')),
  upload_url text,
  bytes_sent bigint not null default 0,
  upload_token text,
  media_item_id text,
  error text,
  -- Short lease so two open tabs never work on the same item at once.
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transfer_items_job on public.transfer_items (job_id, created_at);
-- Ledger: a Drive file is added to Google Photos at most once.
create unique index transfer_items_uploaded_once
  on public.transfer_items (drive_file_id) where media_item_id is not null;

alter table public.photo_albums enable row level security;
alter table public.transfer_jobs enable row level security;
alter table public.transfer_items enable row level security;

create policy "operators read albums" on public.photo_albums
  for select to authenticated using (public.is_azo_operator());
create policy "operators read jobs" on public.transfer_jobs
  for select to authenticated using (public.is_azo_operator());
create policy "operators read items" on public.transfer_items
  for select to authenticated using (public.is_azo_operator());

revoke insert, update, delete on public.photo_albums, public.transfer_jobs, public.transfer_items
  from anon, authenticated;

-- Event photos uploaded by staff, stored in a public Supabase Storage bucket.
-- An event shows either this photo or an album photo (events.cover_media_id); the last one chosen wins.

alter table public.events add column cover_image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff read event covers" on storage.objects
  for select to authenticated using (bucket_id = 'event-covers' and public.is_staff());

create policy "staff upload event covers" on storage.objects
  for insert to authenticated with check (bucket_id = 'event-covers' and public.is_staff());

create policy "staff update event covers" on storage.objects
  for update to authenticated using (bucket_id = 'event-covers' and public.is_staff())
  with check (bucket_id = 'event-covers' and public.is_staff());

create policy "staff delete event covers" on storage.objects
  for delete to authenticated using (bucket_id = 'event-covers' and public.is_staff());

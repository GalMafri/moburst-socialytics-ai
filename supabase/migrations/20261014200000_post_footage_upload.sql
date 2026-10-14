-- Filmed video posts (a real person on camera) get their footage from an
-- upload: the clip is kept privately, and the video worker lays the post's
-- hook and the client's logo file over it, keeping its sound.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-footage', 'post-footage', false, 524288000, array['video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

drop policy if exists "Members upload post footage" on storage.objects;
create policy "Members upload post footage" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-footage' and (public.is_moburst_staff() or public.is_client_member(((storage.foldername(name))[1])::uuid)));

drop policy if exists "Members read post footage" on storage.objects;
create policy "Members read post footage" on storage.objects for select to authenticated
  using (bucket_id = 'post-footage' and (public.is_moburst_staff() or public.is_client_member(((storage.foldername(name))[1])::uuid)));

alter table public.design_requests add column if not exists footage_path text;

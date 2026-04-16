-- Create the generated-media storage bucket for persisting designs and videos
insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-media', 'generated-media', true, 52428800)
on conflict (id) do nothing;

-- Allow public read access
create policy "Public read access for generated media"
on storage.objects for select
using (bucket_id = 'generated-media');

-- Allow authenticated uploads
create policy "Allow uploads to generated media"
on storage.objects for insert
with check (bucket_id = 'generated-media');

-- Allow updates (upsert)
create policy "Allow updates to generated media"
on storage.objects for update
using (bucket_id = 'generated-media');

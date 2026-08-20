-- Recover historical post authorship from Supabase Storage.
--
-- post_iterations.created_by was null on all 132 historical rows, so per-user
-- timelines were empty and three people who had done real work showed as
-- "logged in, no output".
--
-- What did NOT work, and why it was rejected:
--   • report_id -> reports.created_by: of the 36 iterations carrying a
--     report_id, zero of those reports have a created_by. Recovers nothing.
--   • reports.report_data: the n8n payload has no user field.
--   • clients.created_by as a proxy: provably wrong. Moburst and NewDay USA
--     each have two known actors, and six clients have none, so this would
--     have written confident but false attribution into the column.
--
-- What does work: storage.objects.owner_id is the authenticated user who
-- performed the upload, recorded by Storage at the time. Generated post media
-- lives in the generated-media bucket keyed <client_id>/<file>, and
-- post_iterations.media_urls contains those file names. That is a record of
-- who did it, not an inference.
--
-- Only unambiguous matches are written (exactly one distinct owner for the
-- row; all 55 matches were unambiguous, zero conflicts) and only where
-- created_by is already null, so nothing existing is overwritten. Re-running
-- is a no-op.
--
-- Ceiling: 55 of 132 rows. The remaining 77 either have no media, or point at
-- the 47 generated-media objects with no owner_id — those were written by the
-- upload-generated-media edge function on the service role, which carries no
-- user identity. Nothing records who was behind them.
--
-- Forward attribution is handled by the auth.uid() column default added in
-- 20260820000000, so this is a one-time repair.

with gm as (
  select o.owner_id::uuid oid, split_part(o.name, '/', 2) file_seg
  from storage.objects o
  join storage.buckets b on b.id = o.bucket_id and b.name = 'generated-media'
  where o.owner_id is not null
),
resolved as (
  select i.id post_id, (array_agg(distinct gm.oid))[1] oid
  from post_iterations i
  join gm on i.media_urls is not null
         and array_to_string(i.media_urls, ',') like '%' || gm.file_seg || '%'
  where i.created_by is null
  group by i.id
  having count(distinct gm.oid) = 1
)
update post_iterations i
   set created_by = r.oid
  from resolved r
 where i.id = r.post_id
   and i.created_by is null;

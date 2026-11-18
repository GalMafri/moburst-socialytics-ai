-- Videos in each platform's upload size (18 Nov 2026: "of course youtube
-- long videos should include landscape").
--
-- Every video was made 9:16. A video now reads its size from platform_sizes
-- as a still does (20261117150000_platform_sizes.sql), with two more
-- formats, the calendar's own kinds of video (formatKind in
-- _shared/calendar/reasonText.ts):
--   short_video  a Reel, a Short or a vertical video;
--   video        any other post made as a video (a YouTube video, a TikTok
--                post, a video post).
-- The row gives the clip's aspect, the pictures drawn for the video and the
-- MP4's size (_shared/video/videoSize.ts). A post with no row is made
-- vertical, as before. The daily platform_sizes job reads these rows from
-- Sprout Social's video specs guide under the same rule as the image rows:
-- a new size is written only when two reads on different days give it
-- (_shared/video/videoSizeRead.ts).
--
-- Additive and safe to run twice: the format check gains two formats (any
-- format a later change adds is kept), and a row already there is never
-- overwritten by a seed. Nothing is removed.

-- ── 1. The formats ──────────────────────────────────────────────────────────

do $$
declare
  v_def text;
  v_formats text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.platform_sizes'::regclass and conname = 'platform_sizes_format';
  select array_agg(distinct f order by f) into v_formats from (
    select m[1] as f from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) formats where f ~ '^[a-z_]+$';
  v_formats := array(select distinct f from unnest(coalesce(v_formats, '{}'::text[]) || array['image', 'carousel', 'story', 'video', 'short_video']) as f order by f);
  alter table public.platform_sizes drop constraint if exists platform_sizes_format;
  execute format('alter table public.platform_sizes add constraint platform_sizes_format check (format = any (%L::text[]))', v_formats);
end $$;

comment on table public.platform_sizes is 'The size a design is uploaded in, per platform and format (image, carousel, story; video and short_video since 18 Nov 2026). A design request reads its row when it is made. Kept current by the daily platform_sizes job: image rows from Sprout Social''s image sizes guide, video rows from its video specs guide.';
comment on column public.platform_sizes.format is 'image, carousel, story: a still (_shared/design/platformSize.ts). video, short_video: a video post (_shared/video/videoSize.ts); short_video is a Reel, a Short or a vertical video, video any other post made as a video.';
comment on column public.design_requests.upload_size is 'The platform_sizes row this request read when it was made: {"platform", "format", "width", "height"}. A still is drawn in it (every option, slide and replacement); a video''s clip, title, logo and MP4 are made in it, and its clip priced in it. Null: no row for the post, or a request from before the table; a still is designed on the 4:5 page (a Story on 9:16), a video made 9:16.';

-- ── 2. The sizes ────────────────────────────────────────────────────────────

-- As Sprout Social's video specs guide recommends them on 18 Nov 2026 (its
-- table "What's the best video size for each social media platform?"):
-- 1080x1920 for Reels, TikTok, Shorts and Facebook video; 1920x1080 for a
-- YouTube video. X lists 1280x720 and 720x1280: its videos stay portrait,
-- as they were made until now. LinkedIn gives a range (256x144 to
-- 4096x2304), so its videos stay 1080x1920, a size its section lists.
-- A row that is already there is left as it is.
insert into public.platform_sizes (platform, format, width, height, source) values
  ('youtube', 'video', 1920, 1080, 'seed'),
  ('youtube', 'short_video', 1080, 1920, 'seed'),
  ('tiktok', 'video', 1080, 1920, 'seed'),
  ('tiktok', 'short_video', 1080, 1920, 'seed'),
  ('instagram', 'video', 1080, 1920, 'seed'),
  ('instagram', 'short_video', 1080, 1920, 'seed'),
  ('facebook', 'video', 1080, 1920, 'seed'),
  ('facebook', 'short_video', 1080, 1920, 'seed'),
  ('x', 'video', 720, 1280, 'seed'),
  ('linkedin', 'video', 1080, 1920, 'seed')
on conflict (platform, format) do nothing;

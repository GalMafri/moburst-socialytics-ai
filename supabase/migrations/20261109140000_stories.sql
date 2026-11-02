-- Stories for Facebook and Instagram (Lital, 2 Nov 2026).
-- Design: docs/superpowers/specs/2026-11-02-stories-design.md
--
-- A Story is a calendar post whose format is Story. One made from a feed post
-- (the post's "Design as a Story", or the weekly planner's companion Stories)
-- names that post in story_of, by its post_key, so the post and its Story
-- link to each other and the calendar shows the Story right after its post.
-- A post has at most one Story: pressing "Design as a Story" again opens the
-- same one (design-request's story action reads this index's rule).
--
-- Additive and safe to run twice. No new table and no new function: the
-- column takes calendar_posts' existing row level security, including the
-- restrictive "OAuth sessions cannot ..." policies of
-- 20261109120000_claude_connector.sql.

alter table public.calendar_posts add column if not exists story_of text;

comment on column public.calendar_posts.story_of is
  'For a Story made from a feed post: that post''s post_key. Null for every other post.';

create unique index if not exists calendar_posts_story_of
  on public.calendar_posts (client_id, story_of)
  where story_of is not null;

-- The table's grants, restated: the new column is read and written like the rest of the row.
revoke all on public.calendar_posts from anon;
grant select, insert, update, delete on public.calendar_posts to authenticated;
grant all on public.calendar_posts to service_role;

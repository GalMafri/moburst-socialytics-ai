-- One copy revision per version of a post (CAL-14). A copy save writes a revision row without media
-- (post_iterations source calendar, regeneration or claude); sending the same save twice, or two saves
-- racing for the next version, can no longer leave two rows at one version.
-- Checked before writing: no post has two media-less copy revisions at one version (0 groups on 12 Nov 2026).
create unique index if not exists post_iterations_copy_revision_version
  on public.post_iterations (client_id, calendar_post_key, version)
  where calendar_post_key is not null and media_urls is null and source in ('calendar', 'regeneration', 'claude');

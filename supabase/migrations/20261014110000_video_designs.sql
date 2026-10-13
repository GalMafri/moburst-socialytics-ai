-- Video posts get a design like every other post (Lital, 13 Oct: "fix video"):
-- a cover card and an end card from the design pipeline, generated footage,
-- joined in an Anthropic-hosted sandbox. A request for one is kind 'video'.
-- Safe to apply twice.
alter table public.design_requests drop constraint if exists design_requests_kind;
alter table public.design_requests add constraint design_requests_kind check (kind = any (array['single'::text, 'carousel'::text, 'video'::text]));

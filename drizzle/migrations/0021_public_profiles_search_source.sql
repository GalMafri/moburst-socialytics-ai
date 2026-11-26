-- A client's own public profiles may also come from a web search for the brand
-- (source 'search'), when neither RivalIQ, the homepage's links nor a person
-- gave one (Lital, 26 Nov 2026: EPIC Studios's homepage links no profiles and
-- Faranak has no website, so nothing was read for either). The lifecycle's
-- accounts step runs the search at most monthly (_shared/lifecycle/steps.ts,
-- competitive/detectHandles.ts findBrandProfiles). A searched profile is never
-- treated as found on the brand's site, so the competitor reads confirm it
-- before reading it (social-read/readJob.ts). Safe to apply twice.

alter table public.client_public_profiles drop constraint if exists client_public_profiles_source_check;
alter table public.client_public_profiles add constraint client_public_profiles_source_check
  check (source in ('rivaliq', 'website', 'search', 'person', 'removed'));

comment on table public.client_public_profiles is 'The client''s own public profile per platform, read without Sprout for its strategy: from RivalIQ''s record of the company, the links on its homepage, a web search for the brand (search), or a person. source person is never overwritten; source removed is a profile a person took away, which never comes back.';
comment on column public.social_profiles.handle_source is 'Where the handle came from: competitor_handles.source (auto, manual, rivaliq) or client_public_profiles.source (website, search, person, rivaliq).';

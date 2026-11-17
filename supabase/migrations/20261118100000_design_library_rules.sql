-- The reference library's rules (17 Nov 2026): a library a person chose is theirs alone;
-- an automatic one holds everyday posts only. Each reviewed post carries its answer to
-- the occasion question and the version of the question it answered.
alter table public.design_reference_reviews
  add column if not exists kind text,
  add column if not exists occasion text,
  add column if not exists evidence text,
  add column if not exists caption_hash text,
  add column if not exists profile_id text,
  add column if not exists rule smallint not null default 1;

alter table public.design_reference_reviews drop constraint if exists design_reference_reviews_kind_check;
alter table public.design_reference_reviews add constraint design_reference_reviews_kind_check
  check (kind is null or kind in ('everyday', 'occasion'));
alter table public.design_reference_reviews drop constraint if exists design_reference_reviews_occasion_check;
alter table public.design_reference_reviews add constraint design_reference_reviews_occasion_check
  check (occasion is null or occasion in ('holiday', 'awareness', 'event', 'person', 'contest'));
alter table public.design_reference_reviews drop constraint if exists design_reference_reviews_occasion_kind_check;
alter table public.design_reference_reviews add constraint design_reference_reviews_occasion_kind_check
  -- "is not distinct from", so a row with no answer (kind null) cannot carry a type either.
  check ((kind is not distinct from 'occasion') = (occasion is not null));

create index if not exists design_reference_reviews_caption on public.design_reference_reviews (client_id, caption_hash);

comment on column public.design_reference_reviews.kind is 'everyday: may enter an automatic library. occasion: made for a holiday, an awareness day, a dated event, a named person or a contest; never enters unless a person keeps it. null: not answered yet.';
comment on column public.design_reference_reviews.profile_id is 'The Sprout profile the post was published on. A post of a profile that is no longer one of the client''s active profiles loses its review. null on a row from before this column: judged by its network.';
comment on column public.design_reference_reviews.rule is 'The version of the review question the row answered (brand-references/corpus.ts REVIEW_RULE). A designed post under an older version is asked once more.';

-- A client's designs build on its whole confirmed post library, chosen per
-- post by the planner, instead of a fixed pick of up to four posts (which made
-- every design rebuild the same layout). Up to 16 posts.
alter table public.design_brand_settings drop constraint if exists design_brand_settings_refs;
alter table public.design_brand_settings add constraint design_brand_settings_refs
  check (cardinality(reference_paths) >= 1 and cardinality(reference_paths) <= 16);
comment on column public.design_brand_settings.reference_paths is 'The client''s confirmed post library (design-references bucket paths). The planner chooses the one or two each design builds on.';

-- A video is an option like a static: one row, files {video, poster}.
alter table public.design_options drop constraint if exists design_options_kind_check;
alter table public.design_options add constraint design_options_kind_check check (kind in ('static', 'carousel', 'slide', 'video'));

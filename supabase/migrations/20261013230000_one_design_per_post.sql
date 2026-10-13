-- One design per post, for every design type (Lital, 13 Oct: "one amazing
-- option per design, not 3"). A finished design becomes the post's design;
-- earlier ones stay on the post so any can be put back in use.
alter table public.design_requests alter column options_wanted set default 1;

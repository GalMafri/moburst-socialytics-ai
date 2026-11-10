-- A video's approved price: the Higgsfield credits for its one clip.
-- Plan: docs/superpowers/plans/2026-11-10-video-one-clip.md (Task 2)
--
-- The price is Higgsfield's live quote (get_cost) for the fixed clip, read at
-- the week's press, or at a single post's request, and kept on the request.
-- The clip step orders only when the live price at that moment is at most
-- this one. Null for a still, and for a video whose price could not be read
-- (its clip step then stops with "This video was not priced when it was
-- queued. Press again to make it."). Re-runnable.

alter table public.design_requests add column if not exists approved_credits numeric;

comment on column public.design_requests.approved_credits is
  'The Higgsfield price for the video''s one clip, approved at the press (or at a single post''s request) and held by the clip step: it orders only at this price or less. Null for a still, or when the price could not be read.';

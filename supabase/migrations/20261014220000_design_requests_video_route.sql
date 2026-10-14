-- How a video post's video is made when the client's own videos cannot be
-- generated: 'posts' is a generated video in the look of the client's static
-- posts, chosen in the Video tab instead of filming. Null is the default route.
alter table public.design_requests add column if not exists video_route text;

-- One saved design per reference creative plan and frame. The browser
-- persists reference creatives when their jobs finish; a post panel that
-- was closed and reopened used to run a second copy of the same plan, and
-- both copies saved. The plan id is part of variant_angle, so the pair is
-- unique per client.
create unique index if not exists idx_post_iterations_reference_creative
  on public.post_iterations (client_id, variant_angle)
  where variant_angle like 'Reference %';

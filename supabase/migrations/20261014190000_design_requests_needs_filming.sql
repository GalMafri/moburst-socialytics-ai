-- A video post whose idea is a real person on camera is filmed, never
-- generated. The post keeps that answer (and who is on camera), so its panel
-- says so every time it is opened and automatic designs never retry it.
alter table public.design_requests add column if not exists on_camera text;
alter table public.design_requests drop constraint if exists design_requests_status_check;
alter table public.design_requests add constraint design_requests_status_check
  check (status = any (array['preparing', 'ready', 'needs_staff', 'canceled', 'needs_filming']));

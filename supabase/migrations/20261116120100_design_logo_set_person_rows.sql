-- A row a person set gets a logo set too (16 Nov 2026, owner decision 2).
-- Spec: docs/superpowers/specs/2026-11-16-logo-tone-design.md, section 4.
--
-- The lifecycle's design_settings step makes a logo set for a row a person
-- set by the same rule as for its own rows, and leaves their logo file,
-- placement, background and date exactly as they are. The step runs when
-- the lifecycle looks at the client. A person's first save of the settings,
-- and every later change of the main logo, asks for that look here, so the
-- set follows within the lifecycle's next look and nobody does anything.
--
-- lifecycle_enqueue is revoked from signed-in users
-- (20261110210000_lifecycle_look_time.sql), so the trigger's function runs
-- as its owner. It queues a look and writes nothing else.
--
-- This file exists only for decision 2: with a no, it is not applied.

create or replace function public.design_settings_look_on_logo()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and (tg_op = 'INSERT' or new.logo_path is distinct from old.logo_path) then
    perform lifecycle_enqueue(new.client_id);
  end if;
  return null;
end $$;
revoke all on function public.design_settings_look_on_logo() from public, anon, authenticated;

drop trigger if exists design_brand_settings_logo_look on public.design_brand_settings;
create trigger design_brand_settings_logo_look after insert or update of logo_path on public.design_brand_settings
  for each row execute function public.design_settings_look_on_logo();

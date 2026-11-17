-- The logo in the tone its picture needs (16 Nov 2026).
-- Spec: docs/superpowers/specs/2026-11-16-logo-tone-design.md, section 4.
--
-- A client's design settings held one logo file in one tone, and a design
-- whose picture needed the other tone was made again until its option
-- failed. The settings row now also holds the client's logo set: the stored
-- file, a second file for the ground the stored file was not made for, the
-- logo in white, and what a design starts from. The lifecycle's
-- design_settings step makes it from the client's own files and posts.
--
-- Everything here is additive. Code from before this migration never reads
-- logo_set, and logo_path, placement, background, source and derived keep
-- their meaning. lifecycle_write_design_settings is unchanged (its conflict
-- branch does not name logo_set, so a rewrite of the settings keeps the
-- set), and so are row level security and every grant on the table.

alter table public.design_brand_settings add column if not exists logo_set jsonb;
comment on column public.design_brand_settings.logo_set is
  'The client''s logo files for light and dark pictures: of (the logo_path it belongs to), rule, own, both, other, white, made, site, person, posts, canvas, at. Written by settle_design_logo_set; a person''s second file by set_design_logo_other.';

-- Who set the row. A write by a signed-in person makes the row a person's,
-- as before, with two additions. A signed-in person changes the logo set
-- only through set_design_logo_other: on any other write of theirs the
-- stored set is put back, so the set is never typed in. And a write that
-- changes nothing but the set (a second logo file added or removed) leaves
-- the row whose it is: the logo, placement and background are still the
-- lifecycle's.
create or replace function public.design_settings_mark_person()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  -- A signed-in person changes the logo set only through set_design_logo_other.
  if coalesce(current_setting('socialytics.logo_other', true), '') <> '1' then
    if tg_op = 'INSERT' then new.logo_set := null; else new.logo_set := old.logo_set; end if;
  end if;
  -- A second logo file added or removed, and nothing else, leaves the row whose it is.
  if tg_op = 'UPDATE' and new.logo_set is distinct from old.logo_set
     and (to_jsonb(new) - 'logo_set') = (to_jsonb(old) - 'logo_set') then
    return new;
  end if;
  new.source := 'person';
  return new;
end $$;

-- The lifecycle's write of a set. It holds only while the row still names
-- the logo the set was made for (p_of) and the person's second file is
-- still what the caller read (p_person, null for none), so a logo or a
-- second file a person saved in between wins and the set is made again. It
-- keeps the row's own person key and writes nothing but logo_set, on rows
-- of either source. True when written.
create or replace function public.settle_design_logo_set(p_client uuid, p_of text, p_person jsonb, p_set jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update design_brand_settings s
     set logo_set = (coalesce(p_set, '{}'::jsonb) - 'person')
                    || case when s.logo_set ? 'person' then jsonb_build_object('person', s.logo_set -> 'person') else '{}'::jsonb end
   where s.client_id = p_client
     and s.logo_path = p_of
     and (s.logo_set -> 'person') is not distinct from p_person;
  return found;
end $$;
revoke all on function public.settle_design_logo_set(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.settle_design_logo_set(uuid, text, jsonb, jsonb) to service_role;

-- A person's own second logo file, put there or removed (p_path null) from
-- the design settings card. Only someone who may write the client, never a
-- Claude connector session, and only a file in the client's own design
-- settings folder under the name the card gives it. The file belongs to the
-- main logo it was put beside (of). Nothing else on the row is written, so
-- the row stays whose it is, and the lifecycle is asked to look, which
-- settles the set with or without the file.
create or replace function public.set_design_logo_other(p_client uuid, p_path text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not public.can_write_client(p_client) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_path is not null and not (starts_with(p_path, p_client::text || '/design-settings/logo-other-') and right(p_path, 4) = '.png') then
    raise exception 'The file is not one of the client''s design settings files.' using errcode = '22023';
  end if;
  perform set_config('socialytics.logo_other', '1', true);
  update design_brand_settings s
     set logo_set = case when p_path is null then s.logo_set - 'person'
                         else coalesce(s.logo_set, '{}'::jsonb)
                              || jsonb_build_object('person', jsonb_build_object('path', p_path, 'of', s.logo_path, 'at', now())) end
   where s.client_id = p_client;
  perform set_config('socialytics.logo_other', '', true);
  perform lifecycle_enqueue(p_client);
end $$;
revoke all on function public.set_design_logo_other(uuid, text) from public, anon;
grant execute on function public.set_design_logo_other(uuid, text) to authenticated, service_role;

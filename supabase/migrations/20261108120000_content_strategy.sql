-- Content strategy tab: each client's content strategy, written by the
-- lifecycle step content_strategy, and people's versions of its sections.
-- Spec: docs/superpowers/specs/2026-11-02-content-strategy-tab-design.md
--
--   content_strategies      one row per client: the product's latest version
--                           of every section, the platform states with the
--                           numbers code worked out, what it was written
--                           from, the inputs key, the written date, the
--                           models and the tokens, and the write under way
--                           (pending), one model call per lifecycle run.
--                           Only the lifecycle writes it (service role). A
--                           row with only a draft (written_at null) holds no
--                           strategy yet.
--   content_strategy_edits  people's versions, one per client and section.
--                           People write it only through
--                           strategy_section_save; the lifecycle never does.
--   strategy_section_save   staff with access to the client save a section,
--                           or hand it back to the product (empty text, or
--                           the product's own words).
--   clients_lifecycle       also fires on posting_rhythm, so a change to it
--                           is looked at at once.
--
-- Staff who can access the client only (is_moburst_staff and
-- can_access_client): client users do not see the strategy in this version.
-- Additive and safe to run again.

-- ── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.content_strategies (
  client_id uuid primary key references public.clients(id) on delete cascade,
  sections jsonb not null default '{}'::jsonb,
  platforms jsonb not null default '[]'::jsonb,
  pillars jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  inputs_key text,
  written_at timestamptz,
  models jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  pending jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.content_strategies is 'The product''s latest content strategy per client, written by the lifecycle step content_strategy. People''s versions of sections are in content_strategy_edits.';
comment on column public.content_strategies.sections is 'The product''s version of every section, by key: goals, audience, positioning, pillar:<name>, platform:<platform>:<posting|new>, not_now, avoid, measures.';
comment on column public.content_strategies.platforms is 'Each platform''s state (posting, new, not_now) with the cadence and 90-day baselines code worked out.';
comment on column public.content_strategies.sources is 'What the strategy was written from (brief, strategy_doc, website, brand_book, competitors, posts).';
comment on column public.content_strategies.written_at is 'When the stored strategy passed every check; null while the row holds only a write under way.';
comment on column public.content_strategies.pending is 'The write under way between lifecycle runs (one model call each): its inputs key, its phase (write, reask, check, fix, recheck), the evidence it is written from, the draft and the usage so far. Null when no write is under way; the stored strategy stays until a new one passes every check.';
comment on column public.content_strategies.usage is 'Model calls and tokens per model for the write: {"calls": {"writer": n, "checker": n}, "tokens": {"<model>": {"input": n, "output": n}}}.';

create table if not exists public.content_strategy_edits (
  client_id uuid not null references public.clients(id) on delete cascade,
  section_key text not null check (btrim(section_key) <> ''),
  text text not null check (btrim(text) <> ''),
  edited_by uuid,
  editor_name text not null default '',
  edited_at timestamptz not null default now(),
  primary key (client_id, section_key)
);
comment on table public.content_strategy_edits is 'People''s versions of content strategy sections. The page shows a person''s version wherever one exists; the lifecycle never writes here, and an edit whose pillar or platform leaves the strategy is kept.';

-- ── 2. Who reads what ───────────────────────────────────────────────────────

alter table public.content_strategies enable row level security;
alter table public.content_strategy_edits enable row level security;

drop policy if exists "Staff read content strategies" on public.content_strategies;
create policy "Staff read content strategies" on public.content_strategies
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "Staff read content strategy edits" on public.content_strategy_edits;
create policy "Staff read content strategy edits" on public.content_strategy_edits
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));

revoke all on public.content_strategies, public.content_strategy_edits from anon, authenticated;
grant select on public.content_strategies, public.content_strategy_edits to authenticated;
grant select, insert, update, delete on public.content_strategies, public.content_strategy_edits to service_role;

-- ── 3. What people can change ───────────────────────────────────────────────

-- A person saves their version of one section. Empty text, or text equal to
-- the product's own version, hands the section back to the product (as
-- emptying a field does in Client setup) and returns null. The editor's name
-- is read here, never sent by the page.
create or replace function public.strategy_section_save(p_client uuid, p_key text, p_text text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_text text := btrim(coalesce(p_text, ''));
  v_product text;
  v_name text;
  v_row public.content_strategy_edits%rowtype;
begin
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change the content strategy.' using errcode = '42501';
  end if;
  if v_key !~ '^(goals|audience|positioning|not_now|avoid|measures|pillar:.+|platform:[a-z0-9]+:(posting|new))$' then
    raise exception 'Unknown strategy section.' using errcode = '22023';
  end if;
  if length(v_text) > 20000 then
    raise exception 'The text is too long.' using errcode = '22001';
  end if;
  select btrim(coalesce(s.sections ->> v_key, '')) into v_product
    from public.content_strategies s where s.client_id = p_client;
  if v_text = '' or v_text = coalesce(v_product, '') then
    delete from public.content_strategy_edits where client_id = p_client and section_key = v_key;
    return null;
  end if;
  -- The name people know the editor by: the profile's display name, else the
  -- part of the email before the @.
  select nullif(btrim(split_part(coalesce(nullif(btrim(pr.display_name), ''), nullif(btrim(pr.email), ''), u.email::text, ''), '@', 1)), '')
    into v_name
    from auth.users u
    left join public.profiles pr on pr.user_id = u.id
   where u.id = auth.uid();
  insert into public.content_strategy_edits as e (client_id, section_key, text, edited_by, editor_name, edited_at)
  values (p_client, v_key, v_text, auth.uid(), coalesce(v_name, ''), now())
  on conflict (client_id, section_key) do update
    set text = excluded.text, edited_by = excluded.edited_by, editor_name = excluded.editor_name, edited_at = excluded.edited_at
  returning e.* into v_row;
  return jsonb_build_object('section_key', v_row.section_key, 'text', v_row.text, 'editor_name', v_row.editor_name, 'edited_at', v_row.edited_at);
end $$;

revoke all on function public.strategy_section_save(uuid, text, text) from public, anon;
grant execute on function public.strategy_section_save(uuid, text, text) to authenticated;

-- ── 4. posting_rhythm in the clients_lifecycle trigger ──────────────────────
-- Unchanged from 20261019220000_lifecycle_steps.sql except posting_rhythm,
-- an input of the content_strategy step.

create or replace function public.lifecycle_on_client_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.website_url is distinct from old.website_url
     or new.name is distinct from old.name
     or (old.archived_at is not null and new.archived_at is null)
     or new.brief_text is distinct from old.brief_text
     or new.brief_file_id is distinct from old.brief_file_id
     or new.strategy_doc_file_path is distinct from old.strategy_doc_file_path
     or new.competitor_seed_notes is distinct from old.competitor_seed_notes
     or new.logo_url is distinct from old.logo_url
     or new.brand_identity is distinct from old.brand_identity
     or new.timezone is distinct from old.timezone
     or new.field_sources is distinct from old.field_sources
     or new.posting_rhythm is distinct from old.posting_rhythm then
    perform lifecycle_enqueue(new.id);
  end if;
  return new;
end $$;

drop trigger if exists clients_lifecycle on public.clients;
create trigger clients_lifecycle after insert or update of website_url, name, archived_at, brief_text, brief_file_id, strategy_doc_file_path,
  competitor_seed_notes, logo_url, brand_identity, timezone, field_sources, posting_rhythm on public.clients
  for each row execute function public.lifecycle_on_client_change();

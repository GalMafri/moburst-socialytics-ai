-- The content calendar as its own tab (Lital, 12 and 13 Oct): every planned
-- post is a row of its own, dated, with the reasons it was planned. Monthly
-- reports plan posts into it; the team can add posts at any time.
--
-- post_key is what copy edits, designs, approvals and design requests attach
-- to. A post imported from a report keeps the key the report's board gave it,
-- so everything already attached to it stays attached; a new post's key is
-- 'post:' plus its id.

create table if not exists public.calendar_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid references public.reports(id) on delete set null,
  post_date date not null,
  posting_time text,
  platform text not null,
  format text,
  pillar text,
  copy text not null default '',
  hashtags text[] not null default '{}',
  cta text,
  visual_direction text,
  rationale text,
  language text,
  -- Why the post is in the plan: [{type: report|performance|trend|competitor|seasonal|idea, label, report_id?}]
  reasons jsonb not null default '[]'::jsonb,
  source text not null default 'ad_hoc' check (source in ('report', 'ad_hoc', 'insight', 'trend_slot')),
  post_key text,
  raw jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.calendar_posts_fill_key() returns trigger language plpgsql as $$
begin
  if new.post_key is null or new.post_key = '' then new.post_key := 'post:' || new.id::text; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists calendar_posts_fill_key on public.calendar_posts;
create trigger calendar_posts_fill_key before insert or update on public.calendar_posts
  for each row execute function public.calendar_posts_fill_key();

alter table public.calendar_posts alter column post_key set not null;
create unique index if not exists calendar_posts_key on public.calendar_posts (client_id, post_key);
create index if not exists calendar_posts_dates on public.calendar_posts (client_id, post_date);
create index if not exists calendar_posts_report on public.calendar_posts (report_id);

alter table public.calendar_posts enable row level security;
revoke all on public.calendar_posts from anon;
grant select, insert, update, delete on public.calendar_posts to authenticated;
drop policy if exists "Read calendar posts" on public.calendar_posts;
create policy "Read calendar posts" on public.calendar_posts for select to authenticated
  using (public.is_moburst_staff() or public.is_client_member(client_id));
drop policy if exists "Staff write calendar posts" on public.calendar_posts;
create policy "Staff write calendar posts" on public.calendar_posts for all to authenticated
  using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));

-- Designs are prepared automatically for upcoming posts only where staff
-- switched it on (each design uses the team's Canva and image allowances).
alter table public.design_brand_settings add column if not exists auto_designs boolean not null default false;

comment on table public.calendar_posts is 'The content calendar: one row per planned post. Reports plan into it; posts can also be added at any time.';

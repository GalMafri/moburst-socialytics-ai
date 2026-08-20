-- Action-level event tracking.
--
-- The user_analytics views count work records, which tells you what people
-- produced but nothing about how they got there: what they clicked, where they
-- gave up, whether generated output was ever opened, or how much of an AI draft
-- survived. That behaviour was never written down anywhere, so unlike the views
-- it cannot be reconstructed. This table starts recording it.
--
-- Identity is stamped by a BEFORE INSERT trigger from the JWT, never sent by
-- the browser, so a client cannot attribute its actions to another user. The
-- table is insert-only for authenticated users and readable only by admins.
--
-- The occurred_at clamp exists because the timestamp comes from the client
-- clock: anything more than an hour ahead or a day behind is replaced with
-- server time rather than trusted.

create table if not exists public.app_events (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  received_at   timestamptz not null default now(),
  event         text not null,
  user_id       uuid references auth.users(id) on delete set null,
  email         text,
  role          text,
  company       text,
  session_id    uuid,
  seq           integer,
  path          text,
  client_id     uuid,
  entity_id     text,
  duration_ms   integer,
  ok            boolean,
  error_code    text,
  props         jsonb not null default '{}'::jsonb
);

create index if not exists app_events_occurred on public.app_events (occurred_at desc);
create index if not exists app_events_user     on public.app_events (user_id, occurred_at desc);
create index if not exists app_events_name     on public.app_events (event, occurred_at desc);
create index if not exists app_events_session  on public.app_events (session_id, seq);
create index if not exists app_events_entity   on public.app_events (entity_id) where entity_id is not null;
create index if not exists app_events_props    on public.app_events using gin (props);

alter table public.app_events enable row level security;

create or replace function public.stamp_app_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.received_at := now();
  if new.user_id is not null then
    select u.email, ur.role::text, pr.hub_company_name
      into new.email, new.role, new.company
    from auth.users u
    left join public.user_roles ur on ur.user_id = u.id
    left join public.profiles   pr on pr.user_id = u.id
    where u.id = new.user_id
    limit 1;
  end if;
  if new.occurred_at is null
     or new.occurred_at > now() + interval '1 hour'
     or new.occurred_at < now() - interval '1 day' then
    new.occurred_at := now();
  end if;
  return new;
end $$;

drop trigger if exists app_events_stamp on public.app_events;
create trigger app_events_stamp before insert on public.app_events
for each row execute function public.stamp_app_event();

drop policy if exists "append own" on public.app_events;
create policy "append own" on public.app_events
  for insert to authenticated with check (true);   -- trigger overwrites identity

drop policy if exists "admin read" on public.app_events;
create policy "admin read" on public.app_events
  for select to authenticated using (public.is_admin());

-- Read path for the usage page. Every function gates on is_admin(); the table
-- itself is never queried directly from the client.
-- Bodies are deployed and kept in sync via the Lovable SQL console; see the
-- User Analytics page for how each is surfaced.

-- A post's time is stored as HH:MM only (CAL-07). On 12 Nov 2026 calendar_posts held 261 rows in 24-hour
-- form and 274 in 12-hour form ("6:00 PM", some with " UTC"), so a day's posts sorted as text (10:00 PM before 6:00 PM).
-- The zone words are not part of the stored time: the card shows the client's zone beside it.

create or replace function public.posting_time_hhmm(t text) returns text
language plpgsql immutable as $$
declare
  m text[];
  h int;
  mi int;
begin
  if t is null then return null; end if;
  m := regexp_match(t, '\m(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\M');
  if m is not null then
    h := m[1]::int;
    mi := coalesce(m[2], '0')::int;
    if h < 1 or h > 12 or mi > 59 then return null; end if;
    return lpad(((h % 12) + case when upper(m[3]) = 'P' then 12 else 0 end)::text, 2, '0') || ':' || lpad(mi::text, 2, '0');
  end if;
  m := regexp_match(t, '\m([01]?\d|2[0-3]):([0-5]\d)\M');
  if m is not null then
    return lpad(m[1], 2, '0') || ':' || m[2];
  end if;
  return null;
end $$;

-- Every writer (the planner, a person's New post, an edit, the connector) lands in the one form.
create or replace function public.calendar_posts_posting_time_hhmm() returns trigger
language plpgsql as $$
begin
  new.posting_time := public.posting_time_hhmm(new.posting_time);
  return new;
end $$;

drop trigger if exists calendar_posts_posting_time on public.calendar_posts;
create trigger calendar_posts_posting_time
  before insert or update of posting_time on public.calendar_posts
  for each row execute function public.calendar_posts_posting_time_hhmm();

-- The existing rows, in one transaction, with the counts checked before and after.
do $$
declare
  before_other int;
  after_other int;
  unparsed int;
begin
  select count(*) into before_other from public.calendar_posts where posting_time is not null and posting_time !~ '^\d{2}:\d{2}$';
  select count(*) into unparsed from public.calendar_posts where posting_time is not null and public.posting_time_hhmm(posting_time) is null;
  if unparsed > 0 then
    raise exception 'posting_time: % rows hold a value that is not a time; none were changed', unparsed;
  end if;
  update public.calendar_posts set posting_time = public.posting_time_hhmm(posting_time)
    where posting_time is not null and posting_time !~ '^\d{2}:\d{2}$';
  select count(*) into after_other from public.calendar_posts where posting_time is not null and posting_time !~ '^\d{2}:\d{2}$';
  if after_other > 0 then
    raise exception 'posting_time: % rows are still not HH:MM (were %)', after_other, before_other;
  end if;
end $$;

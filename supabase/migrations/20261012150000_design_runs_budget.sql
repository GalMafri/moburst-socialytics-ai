-- A run's credit budget: three options with two whole-frame plates each (about 4.6 credits a plate on GPT Image) plus a fix round
-- did not fit in 30 credits (the first plate run stopped after one option at 27.5). The server default moves to 45.
alter table public.design_runs alter column budget set default '{"max_turns": 24, "max_usd": 6, "max_credits": 45}'::jsonb;
create or replace function public.design_runs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open integer;
  v_today integer;
begin
  new.status := 'queued';
  new.budget := '{"max_turns": 24, "max_usd": 6, "max_credits": 45}'::jsonb;
  new.spent := '{}'::jsonb;
  new.plan := '{}'::jsonb;
  new.sizes := '[]'::jsonb;
  new.attempts := 0;
  new.lease_until := null;
  new.lease_token := null;
  new.failure := null;
  new.started_at := null;
  new.finished_at := null;
  new.copy := left(coalesce(new.copy, ''), 4000);
  if length(trim(new.copy)) = 0 then
    raise exception 'A design run needs the post copy.' using errcode = 'check_violation';
  end if;
  if new.platform is null or length(new.platform) > 40 or new.format is null or length(new.format) > 40 then
    raise exception 'A design run needs a platform and a format.' using errcode = 'check_violation';
  end if;
  select count(*) into v_open from public.design_runs
   where client_id = new.client_id and post_key = new.post_key and format = new.format and status in ('queued', 'running');
  if v_open > 0 then
    raise exception 'A % run is already in progress for this post.', new.format using errcode = 'unique_violation';
  end if;
  select count(*) into v_today from public.design_runs where client_id = new.client_id and created_at > now() - interval '1 day';
  if v_today >= 60 then
    raise exception 'This client has reached today''s limit of design runs.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

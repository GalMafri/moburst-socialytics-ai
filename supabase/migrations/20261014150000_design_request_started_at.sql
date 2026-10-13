-- When a design request's current preparation began. A request that starts
-- preparing again (its designs finished once more, 13 Oct) counts its wait
-- from then, not from when it was first asked for.
alter table public.design_requests add column if not exists started_at timestamptz;
update public.design_requests set started_at = created_at where started_at is null;
alter table public.design_requests alter column started_at set default now();
alter table public.design_requests alter column started_at set not null;

create or replace function public.design_requests_mark_started()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'preparing' and old.status is distinct from 'preparing' then
    new.started_at := now();
  end if;
  return new;
end $$;

drop trigger if exists design_requests_mark_started on public.design_requests;
create trigger design_requests_mark_started before update of status on public.design_requests
  for each row execute function public.design_requests_mark_started();

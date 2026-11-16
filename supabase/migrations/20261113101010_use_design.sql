-- Putting a design in use, in one statement. The design-request function used
-- to switch the post's other designs off and the chosen one on in two writes,
-- and accepted any row, a deleted design included. Now only a live design
-- option (not deleted, not turned down with Not right) goes in use, and the
-- switch is one update, so a post is never left with none or two in use.
-- Answers whether the design was put in use.
create or replace function public.use_design(p_iteration uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row public.post_iterations%rowtype;
  v_count integer;
begin
  select * into v_row from public.post_iterations
   where id = p_iteration
     and variant_angle ~ '^Design option [0-9]+$'
     and archived_at is null
     and rejected_at is null;
  if not found then return false; end if;
  update public.post_iterations p
     set is_selected = (p.id = v_row.id)
   where p.id = v_row.id
      or (v_row.calendar_post_key is not null
          and p.client_id = v_row.client_id
          and p.calendar_post_key = v_row.calendar_post_key
          and p.is_selected);
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

revoke all on function public.use_design(uuid) from public, anon, authenticated;
grant execute on function public.use_design(uuid) to service_role;

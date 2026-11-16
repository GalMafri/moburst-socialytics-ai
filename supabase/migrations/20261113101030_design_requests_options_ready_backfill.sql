-- Requests that finished before options_ready was kept show a count of 0. The
-- count is the designs in the request's group (post_iterations whose
-- variant_group_id is the request); updated_at is left as it is.
update public.design_requests r
   set options_ready = d.n
  from (
    select p.variant_group_id as id, count(*)::int as n
      from public.post_iterations p
     where p.variant_angle ~ '^Design option [0-9]+$'
       and p.variant_group_id is not null
     group by p.variant_group_id
  ) d
 where r.id = d.id
   and r.status = 'ready'
   and coalesce(r.options_ready, 0) = 0;

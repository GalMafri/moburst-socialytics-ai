-- Every Moburst user sees every client (Lital, 9 Nov 2026: "all moburst users
-- [need] access to see all clients as a moburst user").
--
-- 20260720130000_company_scoped_staff.sql limited a Moburst user whose Hub
-- account lists companies to those companies. Nobody was ever limited that way
-- (the Hub bridge made such people clients until 9 Nov), and it isn't wanted:
-- Moburst staff work on every client. So the two staff checks stop applying the
-- company limit:
--   can_access_client: admin, any Moburst user, or a client of that company
--   can_manage_roster: admin or any Moburst user
-- can_write_client (staff and can_access_client) follows. Clients are unchanged:
-- they reach only their own companies, read only. is_company_restricted() stays
-- as it is, since is_client_member uses it to keep old manual client links out
-- of a Hub client's session; the Hub's company list stays on the profile for
-- that. Safe to apply twice.

create or replace function public.can_access_client(_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_moburst_staff() or public.is_client_member(_client_id)
$$;

create or replace function public.can_manage_roster()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_moburst_staff()
$$;

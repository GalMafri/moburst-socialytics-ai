-- Subliy's company_slug was 'subliy'; the canonical portal slug is 'subily'.
-- The l and i are transposed.
--
-- This was not only a reporting gap. is_client_member() matches
-- profiles.allowed_company_slugs (written from the portal) against
-- clients.company_slug, so the mismatch meant the two users granted access to
-- Subliy could not see the client at all.
--
-- 'subily' is confirmed to exist in the portal catalog because two users have
-- been granted it, and a slug cannot be granted unless the company exists.
-- Nothing has ever been granted 'subliy'.
update public.clients set company_slug = 'subily'
 where name = 'Subliy' and company_slug = 'subliy';

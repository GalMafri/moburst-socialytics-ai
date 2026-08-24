-- LegaBot: canonical slug from the gOS portal Companies page.
--
-- Worth recording how this was nearly got wrong. The canonical catalog lives in
-- the Auth Service (GET /companies), which needs a token we do not hold, so the
-- slug list was inferred from profiles.allowed_company_slugs instead. That
-- column only contains slugs GRANTED TO A USER, not the whole catalog. LegaBot
-- is in the catalog but had never been granted to anyone, so it looked absent
-- and the wrong conclusion was drawn — that no canonical slug existed.
--
-- Rule: allowed_company_slugs proves a slug EXISTS; its absence proves nothing.
-- Confirm against the portal before concluding a company is missing.
update public.clients set company_slug = 'legabot'
 where name = 'LegaBot' and company_slug is null;

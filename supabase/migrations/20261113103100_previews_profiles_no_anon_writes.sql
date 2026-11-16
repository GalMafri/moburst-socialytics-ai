-- post_previews and sprout_profiles carried the default grants every table in
-- public gets: TRUNCATE and all writes for anon and authenticated. Row policies
-- do not apply to TRUNCATE, so any signed-in session, and anon for these two
-- tables, could empty them. Read live on 12 Nov 2026: both roles held DELETE,
-- INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE on both tables.
--
-- TRUNCATE goes from both roles. The write privileges go from anon, which has
-- no policy that allows a write on either table. Signed-in sessions keep
-- INSERT, UPDATE and DELETE, which the staff and client policies on
-- sprout_profiles, and the OAuth-session policies on both tables, are written
-- against. Safe to run again.

revoke truncate on public.post_previews, public.sprout_profiles from anon, authenticated;
revoke insert, update, delete on public.post_previews, public.sprout_profiles from anon;

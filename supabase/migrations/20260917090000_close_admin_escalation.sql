-- Three ways to become an admin, closed.
--
-- 1. Public signup is open on this project and the anon key ships in the
--    browser bundle, so anyone can create a row in auth.users. A trigger then
--    granted every new row the admin role, unconditionally. is_admin() is the
--    USING clause on roughly fifteen cmd=ALL policies, and it is the only thing
--    keeping the Gemini key out of reach in app_settings, so that trigger made
--    the whole database one signup away from a stranger. Both bridges assign
--    the role explicitly (each deletes every user_roles row and inserts the
--    mapped one), so nothing depends on the trigger.
--
--    handle_new_user stays. It only creates the profile row.
DROP TRIGGER IF EXISTS on_auth_user_created_assign_admin ON auth.users;
DROP FUNCTION IF EXISTS public.assign_admin_to_new_user();

-- 2. "Users can update their own profile" is FOR UPDATE USING (user_id =
--    auth.uid()) and the authenticated role held UPDATE on every column. RLS
--    cannot restrict columns, and two of those columns are hub_company_name and
--    allowed_company_slugs, which is exactly what is_client_member() reads to
--    decide which clients you may see. One PostgREST call gave any signed-in
--    user another client's reports.
--
--    No client code writes this table at all (useAuth.tsx reads it, nothing
--    else touches it) and both bridges write it with the service role, which
--    bypasses grants. So the table grant goes and only the two cosmetic columns
--    come back. The row filter in the policy still applies on top.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

-- 3. Four accounts hold admin for no good reason.
--
--    litalcastel@gmail.com and litalcastell@gmail.com (a typo pair created the
--    same day in February, never used since) have no hub_user_id at all, so the
--    trigger above is the only thing that could have made them admins.
--    x@x.com and dev@moburst.local carry hub_user_id 'dev-x@x.com' and
--    'dev-dev@moburst.local', the signature of hub-auth-bridge's devEmail path,
--    which minted admin sessions for any address behind a spoofable Origin
--    header. That path is removed in the same commit as this migration.
--
--    The other six admins with no auth_source are NOT touched. They carry real
--    hub ids, which means the legacy hub bridge assigned them admin on purpose;
--    sinead@ signed in yesterday. Reading "no auth_source" as "never
--    role-mapped" would have locked out working staff, because the legacy
--    bridge writes hub_user_id and no auth_source.
DELETE FROM public.user_roles r
USING auth.users u
WHERE r.user_id = u.id
  AND r.role = 'admin'
  AND u.email IN (
    'litalcastel@gmail.com',
    'litalcastell@gmail.com',
    'x@x.com',
    'dev@moburst.local'
  );

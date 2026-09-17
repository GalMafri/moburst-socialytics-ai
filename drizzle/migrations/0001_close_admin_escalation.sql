DROP TRIGGER IF EXISTS on_auth_user_created_assign_admin ON auth.users;
DROP FUNCTION IF EXISTS public.assign_admin_to_new_user();

REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

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
-- An unsigned caller could execute is_demo_client. Only signed-in users (the
-- row policies that call it) and the service role need it.
revoke execute on function public.is_demo_client(uuid) from anon;

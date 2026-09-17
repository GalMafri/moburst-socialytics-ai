// TEMPORARY one-off probe: verifies the admin createUser API still works while
// public signup is disabled. Deleted immediately after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const email = "signup-flag-probe@moburst-test.invalid";
  const password = crypto.randomUUID() + "Aa1!";
  const out: Record<string, unknown> = {};

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  out.create_ok = !error;
  out.create_error = error ? { message: error.message, status: (error as { status?: number }).status, code: (error as { code?: string }).code } : null;
  out.created_user_id = data?.user?.id ?? null;

  let id = data?.user?.id ?? null;
  if (!id) {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    id = list?.users?.find((u) => (u.email || "").toLowerCase() === email)?.id ?? null;
    out.found_by_list = id;
  }

  if (id) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(id);
    out.delete_ok = !delErr;
    out.delete_error = delErr ? delErr.message : null;
  } else {
    out.delete_ok = null;
  }

  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});

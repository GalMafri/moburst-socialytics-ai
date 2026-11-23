/**
 * The production wiring of the public actions (actions.ts) over the service
 * role: the internal functions called as the project acting for a person
 * (_shared/invoke.ts), the person behind a caller, and the calendar post an
 * action names. The api function serves the actions over HTTP; the Claude
 * connector (mcp) runs the same action routes in process for key callers and
 * staff, so both start work the same way.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AuthContext } from "../api/router.ts";
import { callFunction, type CallEnv } from "../invoke.ts";
import type { ActionAdapterDeps, CalendarPostRow } from "./actions.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The person a caller acts as: the signed-in person, else the API key's owner (owner_user_id, else created_by). */
export async function actingUserOf(db: SupabaseClient, auth: AuthContext): Promise<string | null> {
  if (auth.userId && UUID.test(auth.userId)) return auth.userId;
  if (!auth.keyId) return null;
  const { data, error } = await db.from("api_keys").select("owner_user_id, created_by").eq("id", auth.keyId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as { owner_user_id?: string | null; created_by?: string | null };
  const id = row.owner_user_id ?? row.created_by ?? null;
  return id && UUID.test(id) ? id : null;
}

export function makeActionDeps(db: SupabaseClient, env: CallEnv): Omit<ActionAdapterDeps, "store"> {
  return {
    call: (name, body, actAs) => callFunction(name, body, { ...env, actAs }),
    actingUser: (auth) => actingUserOf(db, auth),
    calendarPost: async (clientId, postKey) => {
      const { data, error } = await db.from("calendar_posts").select("client_id, post_key, report_id, platform, format, pillar, copy, cta, visual_direction, rationale").eq("client_id", clientId).eq("post_key", postKey).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as CalendarPostRow | null) ?? null;
    },
  };
}

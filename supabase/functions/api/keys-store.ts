/** api_keys over supabase-js. The hash never leaves this module except into the row. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { KeyStore, StoredKey } from "./routes-admin.ts";

/** Every column the store reads; schema-check.ts tries the same list against the live table. */
export const KEY_COLUMNS = "id, name, key_prefix, key_hash, scopes, company_slugs, client_ids, rate_limit_per_minute, created_by, created_at, expires_at, last_used_at, revoked_at, note, owner_user_id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;

export function makeKeyStore(db: SupabaseClient): KeyStore {
  // owner_user_id references auth.users, which PostgREST cannot embed profiles through, so the emails are one more query.
  const withOwnerEmails = async (rows: Array<Omit<StoredKey, "owner_email">>): Promise<StoredKey[]> => {
    const owners = [...new Set(rows.map((r) => r.owner_user_id).filter((id): id is string => !!id))];
    const emails = new Map<string, string | null>();
    if (owners.length) {
      const { data, error } = await db.from("profiles").select("user_id, email").in("user_id", owners);
      if (error) throw new Error(error.message);
      for (const p of (data ?? []) as Array<{ user_id: string; email: string | null }>) emails.set(p.user_id, p.email);
    }
    return rows.map((r) => ({ ...r, owner_email: r.owner_user_id ? emails.get(r.owner_user_id) ?? null : null }));
  };
  const keys = async (query: Result): Promise<StoredKey[]> => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return withOwnerEmails((data ?? []) as Array<Omit<StoredKey, "owner_email">>);
  };

  return {
    async insert(k) {
      const { data, error } = await db.from("api_keys").insert(k).select(KEY_COLUMNS).single();
      if (error) throw new Error(error.message);
      return (await withOwnerEmails([data as Omit<StoredKey, "owner_email">]))[0];
    },
    list: () => keys(db.from("api_keys").select(KEY_COLUMNS).order("created_at", { ascending: false })),
    listByOwner: (userId) => keys(db.from("api_keys").select(KEY_COLUMNS).eq("owner_user_id", userId).order("created_at", { ascending: false })),
    async revoke(id) {
      const { data, error } = await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
    async revokeOwned(id, userId) {
      // Not a uuid is not a key: the database would refuse the filter rather than find nothing.
      if (!UUID.test(id)) return null;
      const { data, error } = await db.from("api_keys").update({ revoked_at: new Date().toISOString() })
        .eq("id", id).eq("owner_user_id", userId).is("revoked_at", null).select("id, revoked_at");
      if (error) throw new Error(error.message);
      const revoked = (data ?? []) as Array<{ id: string; revoked_at: string }>;
      if (revoked.length) return revoked[0];
      // Nothing live to revoke: either it was revoked before (answer that time) or it is not this person's key.
      const { data: had, error: readError } = await db.from("api_keys").select("id, revoked_at").eq("id", id).eq("owner_user_id", userId).maybeSingle();
      if (readError) throw new Error(readError.message);
      const row = had as { id: string; revoked_at: string | null } | null;
      return row?.revoked_at ? { id: row.id, revoked_at: row.revoked_at } : null;
    },
  };
}

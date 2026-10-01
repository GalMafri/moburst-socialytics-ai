/** api_keys over supabase-js. The hash never leaves this module except into the row. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { KeyStore, StoredKey } from "./routes-admin.ts";

const COLUMNS = "id, name, key_prefix, key_hash, scopes, company_slugs, client_ids, rate_limit_per_minute, created_by, created_at, expires_at, last_used_at, revoked_at, note";

export function makeKeyStore(db: SupabaseClient): KeyStore {
  return {
    async insert(k) {
      const { data, error } = await db.from("api_keys").insert(k).select(COLUMNS).single();
      if (error) throw new Error(error.message);
      return data as StoredKey;
    },
    async list() {
      const { data, error } = await db.from("api_keys").select(COLUMNS).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as StoredKey[];
    },
    async revoke(id) {
      const { data, error } = await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
  };
}

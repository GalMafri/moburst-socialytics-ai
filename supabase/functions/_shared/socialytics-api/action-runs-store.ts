/** api_action_runs over supabase-js: the idempotency keys of public actions (migration 20261123150000). */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionClaim, ActionRunRecord, ActionRunStore } from "../api/actions.ts";

const match = (db: SupabaseClient, c: ActionClaim) => ({
  update: (patch: Record<string, unknown>) => db.from("api_action_runs").update(patch).eq("owner", c.owner).eq("action", c.action).eq("idempotency_key", c.idempotency_key),
  remove: () => db.from("api_action_runs").delete().eq("owner", c.owner).eq("action", c.action).eq("idempotency_key", c.idempotency_key),
});

export function makeActionRunStore(db: SupabaseClient): ActionRunStore {
  return {
    async claim(c) {
      const { data, error } = await db.rpc("api_action_claim", { p_owner: c.owner, p_action: c.action, p_key: c.idempotency_key, p_hash: c.request_hash, p_client: c.client_id });
      if (error) throw new Error(`idempotency claim failed: ${error.message}`);
      const row = ((data ?? []) as Array<ActionRunRecord & { claimed: boolean }>)[0];
      if (!row) throw new Error("idempotency claim answered nothing");
      if (row.claimed) return { claimed: true };
      return { claimed: false, existing: { status: row.status, request_hash: row.request_hash, response_status: row.response_status, response: row.response } };
    },
    async finish(c, res) {
      const { error } = await match(db, c).update({ status: "done", response_status: res.status, response: res.body, completed_at: new Date().toISOString() });
      if (error) console.error(`idempotency record for ${c.action} not saved: ${error.message}`);
    },
    async release(c) {
      const { error } = await match(db, c).remove();
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Every column list the API reads, tried against the live database with a
 * zero-row select. A renamed or dropped column shows up as a finding on
 * GET /v1/status (which the smoke suite hits) the same day, instead of as
 * a 500 for a consumer.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Finding } from "./health.ts";
import { ALERT_COLUMNS, CLIENT_COLUMNS, COMPETITIVE_COLUMNS, COMPETITIVE_LIST_COLUMNS, COMPETITOR_COLUMNS, DESIGN_SYSTEM_COLUMNS, HANDLE_COLUMNS, MEDIA_JOB_COLUMNS, POST_COLUMNS, REPORT_COLUMNS, REPORT_LIST_COLUMNS, SCHEDULE_COLUMNS, SCHEDULED_POST_COLUMNS, SET_COLUMNS, SPROUT_PROFILE_COLUMNS } from "./store.ts";

export const TABLE_COLUMNS: Array<[string, string]> = [
  ["clients", CLIENT_COLUMNS], ["sprout_profiles", SPROUT_PROFILE_COLUMNS], ["competitor_sets", SET_COLUMNS], ["competitors", COMPETITOR_COLUMNS], ["competitor_handles", HANDLE_COLUMNS],
  ["reports", REPORT_COLUMNS], ["reports", REPORT_LIST_COLUMNS], ["competitive_reports", COMPETITIVE_COLUMNS], ["competitive_reports", COMPETITIVE_LIST_COLUMNS],
  ["post_iterations", POST_COLUMNS], ["media_jobs", MEDIA_JOB_COLUMNS], ["report_schedules", SCHEDULE_COLUMNS], ["scheduled_posts", SCHEDULED_POST_COLUMNS], ["competitive_alerts", ALERT_COLUMNS], ["client_design_systems", DESIGN_SYSTEM_COLUMNS],
  ["profiles", "user_id, email"], ["user_roles", "user_id, role"],
  ["api_keys", "id, name, key_prefix, key_hash, scopes, company_slugs, client_ids, rate_limit_per_minute, created_by, created_at, expires_at, last_used_at, revoked_at, note"],
  ["demo_jobs", "id, tool, key_id, idempotency_key, status, input, requester, callback_url, callback_status, client_id, run_ids, steps, outputs, gaps, error, lease_until, next_check_at, created_at, started_at, completed_at, updated_at"],
];

export async function schemaCheck(db: Pick<SupabaseClient, "from">): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [table, columns] of TABLE_COLUMNS) {
    const { error } = await db.from(table).select(columns).limit(0);
    if (error) out.push({ kind: "api_schema_drift", severity: "high", client_id: null, client: "Socialytics API", detail: `${table}: ${error.message}`, link: null, report_id: null, job_id: null });
  }
  return out;
}

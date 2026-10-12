

## Fix: Reports Stuck on "Running" Forever

### Problem
The n8n workflow tries to update the `reports` table using the anon key, but RLS policies were blocking it -- causing report rows to never get updated from "running" to "complete."

### What's Already Done
**Change 1 (RLS Policy)** is already applied. The policy `"Allow anon to update reports from n8n"` exists on the `reports` table, scoped to the `anon` role with full UPDATE access. No migration needed.

### What Will Be Built

**Change 2: New `update-report` Edge Function**

A new backend function at `supabase/functions/update-report/index.ts` that provides a reliable, RLS-bypassing endpoint for n8n to call when updating report status and data.

**Behavior:**
- Accepts `POST` requests with a JSON body containing: `report_id` (required), `status`, `report_data`, `gamma_url`, `duration_minutes`
- Uses the service role key (already available as a system secret) to create a privileged database client that bypasses RLS entirely
- Updates the matching row in the `reports` table with whichever fields are provided
- Returns the updated row as JSON on success

**Error handling:**
- `400` if `report_id` is missing from the body
- `404` if no report row matches the given ID
- `500` for any unexpected server errors
- All responses include CORS headers

**Configuration:**
- `verify_jwt = false` in `config.toml` so n8n can call it without authentication
- The function will be auto-deployed

### No Frontend Changes
No modifications to `RunAnalysis.tsx`, `ReportView.tsx`, or any other frontend files.

### Technical Details

**New file:** `supabase/functions/update-report/index.ts`

```text
POST /update-report
Content-Type: application/json

{
  "report_id": "uuid",
  "status": "complete",
  "report_data": { ... },
  "gamma_url": "https://...",
  "duration_minutes": 12
}
```

**Config update:** `supabase/config.toml` -- add `[functions.update-report]` with `verify_jwt = false`.

**n8n integration:** Once deployed, the n8n workflow can call this function's URL instead of directly PATCHing the `reports` table. The function URL will follow the pattern:

```
https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/update-report
```


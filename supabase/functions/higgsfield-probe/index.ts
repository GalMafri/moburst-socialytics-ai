// supabase/functions/higgsfield-probe/index.ts
//
// Which Higgsfield models this account can actually reach.
//
// The published OpenAPI spec does not match the live API — the first
// integration attempt burned a day on routes that 404 — and the enabled model
// set is account-specific and changes. So the app never guesses: this asks,
// and the answer goes into HIGGSFIELD_IMAGE_MODEL_PATH / _VIDEO_MODEL_PATH.
//
// Read-only. It submits nothing and spends no credits: every probe is a
// deliberately empty POST, and a 422 (schema rejected an empty body) is the
// signal that the route EXISTS, while 404 means it does not.

import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { HIGGSFIELD_BASE_URL, authHeader, resolveCredentials } from "../_shared/higgsfield/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Routes worth asking about, newest naming first. */
const CANDIDATES = [
  "/v1/models",
  "/v1/model",
  "/models",
  "/v1/nano-banana-pro",
  "/v1/nano_banana_pro",
  "/nano-banana-pro",
  "/nano-banana",
  "/v1/seedance-2-5",
  "/seedance-2-5",
  "/higgsfield-ai/popcorn/auto",
  "/higgsfield-ai/soul/standard",
  "/higgsfield-ai/dop/standard",
  "/v1/image2video/seedance",
  "/v1/text2image/nano-banana",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    await requireStaff(req);
    const creds = resolveCredentials();
    const auth = authHeader(creds);
    const extra: string[] = [];
    try {
      const body = await req.json();
      if (Array.isArray(body?.paths)) extra.push(...body.paths.filter((p: unknown) => typeof p === "string"));
    } catch {
      // no body is fine
    }

    const results: Array<{ path: string; method: string; status: number; body: string }> = [];
    for (const path of [...CANDIDATES, ...extra]) {
      for (const method of ["GET", "POST"] as const) {
        // GET only for the catalogue-ish routes; POST for model routes.
        if (method === "GET" && !path.includes("model")) continue;
        if (method === "POST" && path.includes("model")) continue;
        try {
          const resp = await fetch(`${HIGGSFIELD_BASE_URL}${path}`, {
            method,
            headers: { Authorization: auth, "Content-Type": "application/json" },
            body: method === "POST" ? JSON.stringify({}) : undefined,
            signal: AbortSignal.timeout(12000),
          });
          const text = (await resp.text().catch(() => "")).slice(0, 300);
          results.push({ path, method, status: resp.status, body: text });
        } catch (e) {
          results.push({ path, method, status: 0, body: String((e as Error)?.name || e) });
        }
      }
    }

    // 404 means the route is not there; anything else means it is.
    const reachable = results.filter((r) => r.status !== 404 && r.status !== 0);
    return json({ base: HIGGSFIELD_BASE_URL, reachable, all: results });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

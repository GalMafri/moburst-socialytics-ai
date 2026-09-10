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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { McpClient } from "../_shared/higgsfield/mcp.ts";
import { MCP_URL, accessTokenFor } from "../_shared/higgsfield/oauth.ts";

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
    // Admin, not merely staff. This function forwards caller-supplied paths,
    // bodies and MCP tool calls to Higgsfield under the team's shared
    // credentials with no allowlist, and its submit mode spends credits. That
    // is a developer's tool, not something every staff session should hold.
    const { asCaller } = await requireStaff(req);
    const { data: isAdmin } = await asCaller.rpc("is_admin");
    if (!isAdmin) return json({ error: "Higgsfield diagnostics are an admin action." }, 403);

    // MCP mode: prove the linked team account works, and what it can reach.
    // Separate from the REST probe below, which uses the API key.
    let mcpAction: string | null = null;
    let mcpArgs: Record<string, unknown> = {};
    let mcpTool: string | null = null;
    try {
      const b = await req.clone().json();
      if (typeof b?.mcp === "string") mcpAction = b.mcp;
      if (typeof b?.tool === "string") mcpTool = b.tool;
      if (b?.args && typeof b.args === "object") mcpArgs = b.args;
    } catch {
      // no mcp block
    }
    if (mcpAction) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const token = await accessTokenFor(admin);
      const mcp = new McpClient({ url: MCP_URL, accessToken: token, timeoutMs: 90_000 });
      if (mcpAction === "tools") {
        const tools = await mcp.listTools();
        return json({ mcp: "tools", count: tools.length, tools: tools.map((t) => t.name) });
      }
      if (mcpAction === "call" && mcpTool) {
        const out = await mcp.callTool(mcpTool, mcpArgs);
        return json({ mcp: "call", tool: mcpTool, isError: out.isError, data: out.data, text: out.text.slice(0, 2000) });
      }
      return json({ error: "mcp must be 'tools', or 'call' with a tool name" }, 400);
    }

    const creds = resolveCredentials();
    const auth = authHeader(creds);
    const extra: string[] = [];
    try {
      const body = await req.clone().json();
      if (Array.isArray(body?.paths)) extra.push(...body.paths.filter((p: unknown) => typeof p === "string"));
    } catch {
      // no body is fine
    }

    // Deliberate submission mode: { submit: { path, body } } posts a real
    // request and SPENDS CREDITS. It exists because entitlement cannot be
    // read anywhere — the dashboard lists three Soul models, the docs say
    // "use the generation endpoint available to your account", and an empty
    // POST returns 422 from schema validation before entitlement is even
    // checked. Only a valid body distinguishes "we have this model" from
    // "we do not".
    let submit: { path?: string; body?: unknown } | null = null;
    try {
      const again = await req.clone().json();
      if (again?.submit?.path) submit = again.submit;
    } catch {
      // no submit block
    }
    // Read one arbitrary GET, so a submitted request's status can be
    // followed without another deploy.
    let get: string | null = null;
    try {
      const again = await req.clone().json();
      if (typeof again?.get === "string") get = again.get;
    } catch {
      // no get block
    }
    if (get) {
      const resp = await fetch(`${HIGGSFIELD_BASE_URL}${get}`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(20000),
      });
      const text = (await resp.text().catch(() => "")).slice(0, 3000);
      return json({ got: get, status: resp.status, body: text });
    }

    if (submit?.path) {
      const resp = await fetch(`${HIGGSFIELD_BASE_URL}${submit.path}`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(submit.body ?? {}),
        signal: AbortSignal.timeout(30000),
      });
      const text = (await resp.text().catch(() => "")).slice(0, 2000);
      return json({ submitted: submit.path, status: resp.status, body: text });
    }

    const results: Array<{ path: string; method: string; status: number; body: string }> = [];
    for (const path of [...CANDIDATES, ...extra]) {
      for (const method of ["GET", "POST"] as const) {
        // GET only for the catalogue-ish routes; POST for model routes.
        // Catalogue routes are read with GET; model routes are POSTed.
        const isCatalogue = path.includes("model");
        if (method === "GET" && !isCatalogue) continue;
        if (method === "POST" && isCatalogue) continue;
        try {
          const resp = await fetch(`${HIGGSFIELD_BASE_URL}${path}`, {
            method,
            headers: { Authorization: auth, "Content-Type": "application/json" },
            body: method === "POST" ? JSON.stringify({}) : undefined,
            signal: AbortSignal.timeout(12000),
          });
          // A path the caller asked for explicitly gets a full answer; the
          // standing candidates only need enough to tell 404 from 422.
          const limit = extra.includes(path) ? 6000 : 300;
          const text = (await resp.text().catch(() => "")).slice(0, limit);
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

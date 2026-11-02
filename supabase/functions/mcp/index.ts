/**
 * mcp: the Claude connector. A remote MCP server people add to Claude once,
 * as themselves, through Supabase Auth's OAuth 2.1 server; Claude then reads
 * the reports, analytics and trends of the clients that person sees in
 * Socialytics, and can change nothing. server.ts holds the request path;
 * this file only wires it to the runtime.
 *
 * verify_jwt is off (config.toml): the function answers the unauthenticated
 * discovery request itself, and withSupabase verifies every token against
 * the project's JWKS. The gate and every store query run through the
 * person's own client, so RLS decides what they see; the audit row and the
 * minute counter go through the service role. Sprout analytics is the one
 * call to another function, through the operational secret acting for the
 * person (see _shared/invoke.ts), after the scope check.
 */
import type { SupabaseContext } from "npm:@supabase/server@1.9.2";
import { callEnvFromDeno, callFunction } from "../_shared/invoke.ts";
import { makeStore } from "../api/store.ts";
import { connectorFetch } from "./server.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PAGE = 1000; // PostgREST's row cap per request

async function visibleClientIds(ctx: SupabaseContext): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.supabase.from("clients").select("id").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    ids.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    if (!data || data.length < PAGE) return ids;
  }
}

Deno.serve(connectorFetch({
  reads: (ctx) => ({
    roles: async (userId) => {
      const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", userId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ role: string }>).map((r) => r.role);
    },
    clientIds: () => visibleClientIds(ctx),
  }),
  tools: (ctx, person) => ({
    // deno-lint-ignore no-explicit-any
    store: makeStore(ctx.supabase as any),
    analytics: async (clientId, start, end) => {
      const r = await callFunction("sprout-analytics", { client_id: clientId, start, end }, callEnvFromDeno(person.userId));
      return { ok: r.ok, status: r.status, data: r.data };
    },
    trendThemes: async (clientId, from, to) => {
      const { data, error } = await ctx.supabase.rpc("trend_themes_in_range", { p_client: clientId, p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return data;
    },
    apiUrl: `${SUPABASE_URL}/functions/v1/api`,
  }),
  touch: async (ctx, userId) => {
    const { data, error } = await ctx.supabaseAdmin.rpc("mcp_rate_touch", { p_user: userId });
    if (error) throw new Error(error.message);
    return Number(data);
  },
  audit: async (ctx, row) => {
    const { error } = await ctx.supabaseAdmin.from("api_requests").insert(row);
    if (error) console.error("mcp audit insert failed:", error.message);
  },
  waitUntil: (p) => { if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p); },
}));

/**
 * mcp: the Claude connector. A remote MCP server people add to Claude once,
 * as themselves, through Supabase Auth's OAuth 2.1 server; Claude then reads
 * the reports, analytics, trends and calendar of the clients that person
 * sees in Socialytics, and Moburst staff also read the strategy and client
 * notes and save notes, approved copy, strategy sections and finished decks
 * (docs/superpowers/specs/2026-11-03-claude-sync-design.md). server.ts holds
 * the request path; this file only wires it to the runtime.
 *
 * verify_jwt is off (config.toml): the function answers the unauthenticated
 * discovery request itself and verifies every token against the project's
 * JWKS (verify.ts). It needs none of the project's new-format API keys: the
 * person's client is built from SUPABASE_URL, SUPABASE_ANON_KEY and their
 * token, as requireStaff builds asCaller, so the gate and every store query
 * run under RLS as them. The service role reaches three places only: the
 * audit row, the minute counter, and the saves' writer (writes.ts
 * makeServiceWriter), which writes after can_write_client answered true as
 * the person (mcp/service-role.test.ts holds this). Sprout analytics is the
 * one call to another function, through the operational secret acting for
 * the person (see _shared/invoke.ts), after the scope check.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callEnvFromDeno, callFunction } from "../_shared/invoke.ts";
import { makeStore } from "../_shared/socialytics-api/store.ts";
import { personReads } from "./reads.ts";
import { connectorFetch, type Caller } from "./server.ts";
import { issuerOf, projectKeys, tokenVerifier } from "./verify.ts";
import { makeServiceWriter, personChecks } from "./writes.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const writer = makeServiceWriter(service);
const PAGE = 1000; // PostgREST's row cap per request

/** One client per request, bound to the person's token, so RLS applies as them. */
const clients = new WeakMap<Caller, SupabaseClient>();
function asPerson(caller: Caller): SupabaseClient {
  let c = clients.get(caller);
  if (!c) {
    c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${caller.token}` } }, auth: { persistSession: false } });
    clients.set(caller, c);
  }
  return c;
}

async function visibleClientIds(db: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("clients").select("id").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    ids.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    if (!data || data.length < PAGE) return ids;
  }
}

Deno.serve(connectorFetch({
  projectUrl: SUPABASE_URL,
  verify: tokenVerifier({ issuer: issuerOf(SUPABASE_URL), keys: projectKeys(SUPABASE_URL) }),
  reads: (caller) => ({
    roles: async (userId) => {
      const { data, error } = await asPerson(caller).from("user_roles").select("role").eq("user_id", userId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ role: string }>).map((r) => r.role);
    },
    clientIds: () => visibleClientIds(asPerson(caller)),
  }),
  tools: (caller, person) => ({
    store: makeStore(asPerson(caller)),
    analytics: async (clientId, start, end) => {
      const r = await callFunction("sprout-analytics", { client_id: clientId, start, end }, callEnvFromDeno(person.userId));
      return { ok: r.ok, status: r.status, data: r.data };
    },
    trendThemes: async (clientId, from, to) => {
      const { data, error } = await asPerson(caller).rpc("trend_themes_in_range", { p_client: clientId, p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return data;
    },
    apiUrl: `${SUPABASE_URL}/functions/v1/api`,
  }),
  personReads: (caller) => personReads(asPerson(caller)),
  writes: (caller) => ({ person: personChecks(asPerson(caller)), writer }),
  touch: async (userId) => {
    const { data, error } = await service.rpc("mcp_rate_touch", { p_user: userId });
    if (error) throw new Error(error.message);
    return Number(data);
  },
  audit: async (row) => {
    const { error } = await service.from("api_requests").insert(row);
    if (error) console.error("mcp audit insert failed:", error.message);
  },
  waitUntil: (p) => { if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p); },
}));

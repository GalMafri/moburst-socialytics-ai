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
 * run under RLS as them. The service role reaches these places only: the
 * audit row, the minute counter, the saves' writer (writes.ts
 * makeServiceWriter), which writes after can_write_client answered true as
 * the person; an API key's lookup (api_key_touch) and its reads (the API's
 * store, whose routes apply the key's reach, and trend_themes_in_range); and
 * the work tools (the API's public actions, their idempotency keys and the
 * cost ledger), which start work only for a key with the run scope or a
 * person who is staff and can change the client (mcp/service-role.test.ts
 * holds this). Sprout analytics and the actions call other functions through
 * the operational secret acting for the person or the key's owner (see
 * _shared/invoke.ts), after the scope check.
 */
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClient } from "../_shared/supabase.ts";
import { callEnvFromDeno, callFunction } from "../_shared/invoke.ts";
import { makeStore } from "../_shared/socialytics-api/store.ts";
import { actingUserOf, makeActionDeps } from "../_shared/socialytics-api/action-deps.ts";
import { makeActionRunStore } from "../_shared/socialytics-api/action-runs-store.ts";
import { costStore } from "../_shared/cost/store.ts";
import type { KeyRow } from "../_shared/api/keys.ts";
import type { AuthContext } from "../_shared/api/router.ts";
import { personReads } from "./reads.ts";
import { connectorFetch, type Caller } from "./server.ts";
import { issuerOf, projectKeys, tokenVerifier } from "./verify.ts";
import { makeServiceWriter, personChecks } from "./writes.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const writer = makeServiceWriter(service);
const env = callEnvFromDeno();
// What an API key and the work tools reach: the API's own lookups and stores over the service role.
const serviceStore = makeStore(service);
const keyLookups = keyLookupsOver(service);
const work = workOver(service);
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

/** api_key_touch and the client list: the API's key lookup (api/index.ts makes the same two). */
function keyLookupsOver(db: SupabaseClient) {
  return {
    touchKey: async (hash: string) => {
      const { data, error } = await db.rpc("api_key_touch", { p_key_hash: hash });
      if (error) throw new Error(error.message);
      return ((data ?? []) as KeyRow[])[0] ?? null;
    },
    clientsForScope: async () => {
      const { data } = await db.from("clients").select("id, company_slug").is("archived_at", null);
      return (data ?? []) as Array<{ id: string; company_slug: string | null }>;
    },
  };
}

/** The work tools' wiring: the public actions as the api function runs them, the cost ledger, and the confirm_token signer. */
function workOver(db: SupabaseClient) {
  const secret = env.secret;
  const key = secret ? crypto.subtle.importKey("raw", new TextEncoder().encode(`mcp-confirm:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : null;
  return {
    actions: { store: makeStore(db), ...makeActionDeps(db, env), runs: makeActionRunStore(db) },
    costs: costStore(db),
    sign: async (text: string) => {
      if (!key) throw new Error("the connector has no secret to sign a confirmation with");
      const sig = await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(text));
      return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

/** What a key's reads use: the API's store over the service role (the routes apply the key's reach), Sprout and trends acting for its owner. */
function keyTools(auth: AuthContext) {
  return {
    store: serviceStore,
    analytics: async (clientId: string, start: string, end: string) => {
      const r = await callFunction("sprout-analytics", { client_id: clientId, start, end }, { ...env, actAs: await actingUserOf(service, auth) });
      return { ok: r.ok, status: r.status, data: r.data };
    },
    trendThemes: async (clientId: string, from: string, to: string) => {
      const { data, error } = await service.rpc("trend_themes_in_range", { p_client: clientId, p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return data;
    },
    apiUrl: `${SUPABASE_URL}/functions/v1/api`,
  };
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
  keys: keyLookups,
  keyTools,
  work,
  waitUntil: (p) => { if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p); },
}));

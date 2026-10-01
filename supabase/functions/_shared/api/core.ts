/**
 * The request handler every API function runs: CORS, routing, the auth
 * the route asks for (none, key, admin, internal), the per-key rate limit,
 * the JSON envelope, and one audit row per request. Tool-agnostic: the
 * routes and the lookups come in through CoreDeps.
 */
import { ApiError, errorBody, forbidden, unauthorized } from "./errors.ts";
import { bearerFrom, hashKey, hasScope, keyIsLive, resolveScope, scopeAll, type KeyRow } from "./keys.ts";
import { matchRoute, apiPath, type AuthContext, type Route, type RouteContext } from "./router.ts";

export interface AuditRow {
  key_id: string | null;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  client_id: string | null;
  job_id: string | null;
  ip: string | null;
  error_code: string | null;
}

export interface CoreDeps {
  tool: string;
  version: string;
  routes: Route[];
  touchKey(keyHash: string): Promise<KeyRow | null>;
  clientsForScope(): Promise<Array<{ id: string; company_slug: string | null }>>;
  verifyAdminJwt(token: string): Promise<{ userId: string } | null>;
  cronSecret: string | null;
  serviceKey: string | null;
  audit(row: AuditRow): Promise<void>;
  waitUntil?(p: Promise<unknown>): void;
  now?(): Date;
  requestId?(): string;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-cron-secret, content-type, apikey, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NO_AUTH: AuthContext = { kind: "none", keyId: null, keyHash: null, scopes: [], clients: scopeAll() };
const INTERNAL: AuthContext = { kind: "internal", keyId: null, keyHash: null, scopes: ["read", "demo", "admin"], clients: scopeAll() };

function isInternal(req: Request, deps: CoreDeps): boolean {
  const cron = req.headers.get("X-Cron-Secret");
  if (deps.cronSecret && cron === deps.cronSecret) return true;
  const auth = req.headers.get("Authorization") ?? "";
  return !!deps.serviceKey && auth === `Bearer ${deps.serviceKey}`;
}

async function keyAuth(req: Request, deps: CoreDeps, now: Date): Promise<{ auth: AuthContext; row: KeyRow }> {
  const raw = bearerFrom(req.headers);
  if (!raw) throw unauthorized();
  const keyHash = await hashKey(raw);
  const row = await deps.touchKey(keyHash);
  if (!row || !keyIsLive(row, now)) throw unauthorized();
  const scopes = (row.scopes ?? []).filter((s): s is AuthContext["scopes"][number] => s === "read" || s === "demo" || s === "admin");
  const clients = row.client_ids?.length || row.company_slugs?.length ? resolveScope(row, await deps.clientsForScope()) : scopeAll();
  return { auth: { kind: "key", keyId: row.id, keyHash, scopes, clients }, row };
}

function secondsToNextMinute(now: Date): number {
  return Math.max(1, 60 - now.getUTCSeconds());
}

async function authenticate(req: Request, route: Route, deps: CoreDeps, now: Date): Promise<{ auth: AuthContext; retryAfter?: number }> {
  if (route.auth === "none") return { auth: NO_AUTH };
  if (route.auth === "internal") {
    if (isInternal(req, deps)) return { auth: INTERNAL };
    throw unauthorized("The worker route takes the internal secret only");
  }
  if (route.auth === "admin") {
    if (isInternal(req, deps)) return { auth: INTERNAL };
    const raw = bearerFrom(req.headers);
    if (!raw) throw unauthorized("An admin session or an admin key is required");
    if (/^(adv|soc)_/.test(raw)) {
      const { auth, row } = await keyAuth(req, deps, now);
      if ((row.minute_count ?? 0) > row.rate_limit_per_minute) throw new ApiError(429, "rate_limited", "Too many requests this minute");
      if (!hasScope(row, "admin")) throw forbidden("This key has no admin scope");
      return { auth };
    }
    const admin = await deps.verifyAdminJwt(raw);
    if (!admin) throw unauthorized("An admin session is required");
    return { auth: { kind: "admin", keyId: null, keyHash: null, scopes: ["read", "demo", "admin"], clients: scopeAll(), userId: admin.userId } };
  }
  const { auth, row } = await keyAuth(req, deps, now);
  if ((row.minute_count ?? 0) > row.rate_limit_per_minute) {
    const e = new ApiError(429, "rate_limited", "Too many requests this minute");
    (e as ApiError & { retryAfter?: number }).retryAfter = secondsToNextMinute(now);
    throw e;
  }
  if (route.scope && !hasScope(row, route.scope)) throw forbidden(`This key has no ${route.scope} scope`);
  return { auth };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...headers } });
}

export async function handleRequest(req: Request, deps: CoreDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const t0 = now().getTime();
  const requestId = (deps.requestId ?? (() => crypto.randomUUID()))();
  const base: Record<string, string> = { "X-Api-Version": deps.version, "X-Request-Id": requestId };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = apiPath(url);
  const audit: AuditRow = { key_id: null, method: req.method, path, status: 0, duration_ms: 0, client_id: null, job_id: null, ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, error_code: null };
  const finish = (res: Response) => {
    audit.status = res.status;
    audit.duration_ms = Math.max(0, now().getTime() - t0);
    const p = deps.audit(audit).catch((e) => console.error("audit failed:", e instanceof Error ? e.message : String(e)));
    if (deps.waitUntil) deps.waitUntil(p);
    return res;
  };
  const fail = (e: ApiError, extra: Record<string, string> = {}) => {
    audit.error_code = e.code;
    return finish(jsonResponse(e.status, errorBody(e), { ...base, ...extra }));
  };

  const m = matchRoute(deps.routes, req.method, path);
  if ("error" in m) {
    if (m.error === "not_found") return fail(new ApiError(404, "not_found", `No route for ${req.method} ${path}`));
    return fail(new ApiError(405, "method_not_allowed", `${req.method} is not allowed on ${path}`), { Allow: m.allowed.join(", ") });
  }
  const { route, params } = m;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (route.path.startsWith("/v1/clients/") && params.id && uuid.test(params.id)) audit.client_id = params.id;
  if (route.path.startsWith("/v1/demo-jobs/") && params.id && uuid.test(params.id)) audit.job_id = params.id;

  let auth: AuthContext;
  try {
    ({ auth } = await authenticate(req, route, deps, now()));
  } catch (e) {
    if (e instanceof ApiError) {
      const ra = (e as ApiError & { retryAfter?: number }).retryAfter;
      return fail(e, ra ? { "Retry-After": String(ra) } : {});
    }
    console.error("auth failed:", e instanceof Error ? e.message : String(e));
    return fail(new ApiError(500, "internal", `The request could not be authenticated (request ${requestId})`));
  }
  audit.key_id = auth.keyId;

  let body: unknown = null;
  if (req.method !== "GET") {
    const text = await req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return fail(new ApiError(400, "invalid_request", "The body is not valid JSON"));
      }
    }
  }

  const ctx: RouteContext = { params, query: url.searchParams, body, auth, requestId, url };
  try {
    const out = await route.handler(ctx);
    return finish(jsonResponse(out.status, out.body, { ...base, ...(out.headers ?? {}) }));
  } catch (e) {
    if (e instanceof ApiError) return fail(e);
    console.error(`request ${requestId} ${req.method} ${path} failed:`, e instanceof Error ? e.message : String(e));
    return fail(new ApiError(500, "internal", `Something went wrong on our side (request ${requestId})`));
  }
}

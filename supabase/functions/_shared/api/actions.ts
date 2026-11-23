/**
 * Public actions: the work a caller starts through the API (a report, a deck,
 * a cancel). Each action is a task with its own fixed input schema and a small
 * adapter (`run`) that calls whatever internal functions do the work today.
 * The internal functions' inputs change with every redesign of the screens;
 * the action's contract does not, so a redesign changes the adapter and the
 * portal, agents and demo screens keep working.
 *
 * actionRoutes turns the definitions into routes that
 *   - need a key with the run scope,
 *   - check that the client the action works on is within the caller's reach
 *     (a client out of reach reads as not found, as the read routes answer),
 *   - make a retry safe: a caller-supplied idempotency_key (a body field)
 *     returns the first answer for the same caller and action instead of
 *     starting paid work twice.
 *
 * `maps` names the internal functions an action calls. Each tool keeps a test
 * that every function its screens call is either mapped by an action or
 * marked internal with a reason, so a new feature fails the build until
 * someone decides.
 *
 * Shared core: tool-agnostic; written in AdVisor, copied by scripts/sync-api-core.sh.
 */
import { stableJson } from "./docs.ts";
import { ApiError, invalid, notFound } from "./errors.ts";
import type { ApiResponse, AuthContext, Method, Route } from "./router.ts";

export interface ActionContext {
  auth: AuthContext;
  requestId: string;
  /** The client the action works on, already checked against the caller's reach. */
  clientId: string;
  idempotencyKey: string | null;
}

export interface ActionResult {
  /** Defaults to the action's documented status. */
  status?: number;
  data: unknown;
}

export type ActionBody = Record<string, unknown>;

export interface ActionDef {
  /** Stable public name (snake_case); tools and docs refer to it. */
  name: string;
  summary: string;
  tag: string;
  method: Method;
  path: string;
  /** Schema names in the tool's SCHEMAS. */
  body: string;
  response: string;
  /** The documented success status: 202 for work that continues after the answer, 200 otherwise. */
  status?: number;
  /** What the path names, for the not-found answer ("Client", "Run"). */
  resource?: string;
  /** The internal functions this action calls today. */
  maps: string[];
  /** The client the action works on, or null when the thing the path names does not exist. */
  clientOf(body: ActionBody, params: Record<string, string>): string | null | Promise<string | null>;
  run(ctx: ActionContext, body: ActionBody, params: Record<string, string>): Promise<ActionResult>;
}

export interface ActionRunRecord {
  status: "running" | "done";
  request_hash: string;
  response_status: number | null;
  response: unknown;
}

export interface ActionClaim {
  owner: string;
  action: string;
  idempotency_key: string;
  request_hash: string;
  client_id: string | null;
}

/**
 * Where idempotency keys are kept. claim records a new key as running and
 * answers claimed, or answers the record already there (a finished one carries
 * the first answer). A record left running by a crashed request, or older than
 * a day, is the store's to expire.
 */
export interface ActionRunStore {
  claim(c: ActionClaim): Promise<{ claimed: true } | { claimed: false; existing: ActionRunRecord }>;
  finish(c: ActionClaim, res: { status: number; body: unknown }): Promise<void>;
  /** Frees the key after a failure, so the caller may try again. */
  release(c: ActionClaim): Promise<void>;
}

export interface ActionDeps {
  runs: ActionRunStore;
}

export const MAX_IDEMPOTENCY_KEY = 200;

/** Whose idempotency keys these are: the API key, else the signed-in person, else the server itself. */
export function ownerOf(auth: AuthContext): string {
  if (auth.keyId) return `key:${auth.keyId}`;
  if (auth.userId) return `user:${auth.userId}`;
  return auth.kind;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The request without its idempotency key: two calls with the same key must ask for the same thing. */
export function requestHash(action: string, params: Record<string, string>, body: ActionBody): Promise<string> {
  const { idempotency_key: _key, ...rest } = body;
  return sha256(stableJson({ action, params, body: rest }));
}

function idempotencyKeyOf(body: ActionBody): string | null {
  const raw = body.idempotency_key;
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw invalid("idempotency_key must be a string", { field: "idempotency_key" });
  const key = raw.trim();
  if (key.length > MAX_IDEMPOTENCY_KEY) throw invalid(`idempotency_key can be at most ${MAX_IDEMPOTENCY_KEY} characters`, { field: "idempotency_key" });
  return key || null;
}

export function actionRoutes(defs: ActionDef[], deps: ActionDeps): Route[] {
  return defs.map((def): Route => ({
    method: def.method, path: def.path, auth: "key", scope: "run",
    doc: { summary: def.summary, tag: def.tag, body: def.body, response: def.response, status: def.status ?? 200 },
    handler: async (ctx): Promise<ApiResponse> => {
      if (ctx.body != null && (typeof ctx.body !== "object" || Array.isArray(ctx.body))) throw invalid("The body must be a JSON object");
      const body = (ctx.body ?? {}) as ActionBody;
      const idempotencyKey = idempotencyKeyOf(body);
      const clientId = await def.clientOf(body, ctx.params);
      if (!clientId || !ctx.auth.clients.allows(clientId)) throw notFound(def.resource ?? "Client");

      const claim: ActionClaim | null = idempotencyKey
        ? { owner: ownerOf(ctx.auth), action: def.name, idempotency_key: idempotencyKey, request_hash: await requestHash(def.name, ctx.params, body), client_id: clientId }
        : null;
      if (claim) {
        const c = await deps.runs.claim(claim);
        if (!c.claimed) {
          if (c.existing.request_hash !== claim.request_hash) throw new ApiError(409, "conflict", "This idempotency_key was already used for a different request");
          if (c.existing.status !== "done" || c.existing.response_status == null) throw new ApiError(409, "conflict", "A request with this idempotency_key is still running; ask again in a moment");
          return { status: c.existing.response_status, body: c.existing.response, headers: { "Idempotent-Replayed": "true" } };
        }
      }

      try {
        const out = await def.run({ auth: ctx.auth, requestId: ctx.requestId, clientId, idempotencyKey }, body, ctx.params);
        const res: ApiResponse = { status: out.status ?? def.status ?? 200, body: { data: out.data } };
        if (claim) await deps.runs.finish(claim, { status: res.status, body: res.body });
        return res;
      } catch (e) {
        // Nothing was started, or what was started failed: the same key may try again.
        if (claim) await deps.runs.release(claim).catch((err) => console.error(`action ${def.name}: idempotency key not released:`, err instanceof Error ? err.message : String(err)));
        throw e;
      }
    },
  }));
}

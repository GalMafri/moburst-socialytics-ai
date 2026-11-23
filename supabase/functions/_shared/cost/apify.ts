/**
 * Apify specifics the meter and the daily audit share:
 *
 *   - Ad-hoc webhooks. Every actor or task run the meter starts carries one
 *     webhook for the run's terminal events, pointing at the app's
 *     cost-apify-webhook function, with the cost context in the payload. The
 *     function re-reads the run from Apify (so the dollars come from Apify,
 *     never from the payload) and records it under apify:<runId>, the same key
 *     the polling reader uses, so a run is counted once whichever path sees it.
 *     Format, from https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks
 *     and https://docs.apify.com/api/v2/act-runs-post: the run request takes
 *     `webhooks`, a Base64-encoded JSON array of webhook definitions
 *     ({ eventTypes, requestUrl, payloadTemplate }); the payload template may
 *     use {{eventType}}, {{eventData}} and {{resource}} (the run object), and
 *     the docs advise a secret token in the request URL.
 *
 *   - Actor ownership. Several Moburst tools use one Apify account, so the
 *     account's run list holds every tool's runs. Each app lists the actors
 *     only it runs (owned) and the ones other tools may run too (shared); the
 *     audit records a missed run only when its actor is owned, and puts every
 *     other missed run up for review. Ids are compared normalised:
 *     "apify/x", "apify~x" and the actor's internal id all name one actor once
 *     the name is resolved (resolveActors).
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { checkContext, type Actor, type CostContext } from "./context.ts";

export const APIFY_FINAL_EVENTS = ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.ABORTED", "ACTOR.RUN.TIMED_OUT"] as const;
export const APIFY_FINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

/** Where Apify sends a finished run: the app's webhook function, with its secret in the URL. */
export interface ApifyWebhookTarget {
  url: string;
  secret: string;
}

/** True for a request that starts an actor or task run (POST /v2/acts/:id/runs, /v2/actor-tasks/:id/runs). */
export function apifyRunStart(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && /^\/v2\/(acts|actor-tasks)\/[^/]+\/runs\/?$/.test(pathname);
}

/** What the payload carries so the webhook can charge the run to the right client and feature. */
export interface ApifyCostPayload {
  tool: string;
  client_id: string | null;
  feature: string;
  execution_id: string | null;
  actor_kind: Actor;
  user_id: string | null;
  api_key_id: string | null;
  qa: boolean;
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The webhook definitions for one run start, as Apify takes them (before Base64). */
export function apifyWebhooks(ctx: CostContext, target: ApifyWebhookTarget): Array<Record<string, unknown>> {
  const cost: ApifyCostPayload = {
    tool: ctx.tool,
    client_id: ctx.clientId ?? null,
    feature: ctx.feature,
    execution_id: ctx.executionId ?? null,
    actor_kind: ctx.actor,
    user_id: ctx.userId ?? null,
    api_key_id: ctx.apiKeyId ?? null,
    qa: !!ctx.qa,
  };
  const u = new URL(target.url);
  u.searchParams.set("secret", target.secret);
  return [{
    eventTypes: [...APIFY_FINAL_EVENTS],
    requestUrl: u.toString(),
    payloadTemplate: `{"eventType": {{eventType}}, "eventData": {{eventData}}, "resource": {{resource}}, "cost": ${JSON.stringify(cost)}}`,
  }];
}

/** The run-start URL with the cost webhook attached. A URL that already names webhooks is left as it is. */
export function withApifyWebhook(url: string, ctx: CostContext, target: ApifyWebhookTarget): string {
  const u = new URL(url);
  if (u.searchParams.has("webhooks")) return url;
  u.searchParams.set("webhooks", base64(JSON.stringify(apifyWebhooks(ctx, target))));
  return u.toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTORS: Actor[] = ["user", "schedule", "system", "api"];
const RUN_ID = /^[A-Za-z0-9]{8,32}$/;

/**
 * Reads a webhook delivery: the run id and the CostContext it should be
 * charged to. Throws with a reason when the payload is not one the meter wrote.
 */
export function parseApifyWebhook(body: unknown, tool: CostContext["tool"]): { runId: string; ctx: CostContext } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, any>;
  const runId = String(b.resource?.id ?? b.eventData?.actorRunId ?? "");
  if (!RUN_ID.test(runId)) throw new Error("The payload names no Apify run");
  const c = (b.cost && typeof b.cost === "object" ? b.cost : null) as Partial<ApifyCostPayload> | null;
  if (!c) throw new Error("The payload carries no cost context");
  if (c.tool !== tool) throw new Error(`The run was started by ${String(c.tool)}, not ${tool}`);
  const clientId = c.client_id == null ? null : String(c.client_id);
  if (clientId !== null && !UUID.test(clientId)) throw new Error("client_id is not a uuid");
  const actor = ACTORS.includes(c.actor_kind as Actor) ? (c.actor_kind as Actor) : "system";
  const ctx: CostContext = {
    tool, clientId, feature: String(c.feature ?? ""), actor,
    executionId: c.execution_id == null ? null : String(c.execution_id).slice(0, 200),
    userId: c.user_id == null ? null : String(c.user_id).slice(0, 200),
    apiKeyId: c.api_key_id == null ? null : String(c.api_key_id).slice(0, 200),
    qa: c.qa === true,
  };
  checkContext(ctx);
  return { runId, ctx };
}

// ── Actor ownership ─────────────────────────────────────────────────────────

/** One actor, by name ("user/actor" or "user~actor"), by Apify id, or both. */
export interface ApifyActorRef {
  name?: string;
  id?: string;
  note?: string;
}

/** The app's Apify actors. owned: only this app runs them. shared: other Moburst tools on the account may run them too. */
export interface ApifyActors {
  owned: readonly ApifyActorRef[];
  shared: readonly ApifyActorRef[];
}

/** "apify/x", "apify~x" and " APIFY~x " are one name; an id is kept as written. */
export function normActor(ref: string): string {
  const s = ref.trim();
  return /[~/]/.test(s) ? s.replace("/", "~").toLowerCase() : s;
}

const refKeys = (r: ApifyActorRef): string[] => [r.name, r.id].filter((x): x is string => !!x).map(normActor);

/** Whether a reference written in code (a name or an id) is on the list. */
export function actorListed(actors: ApifyActors, ref: string): boolean {
  const k = normActor(ref);
  return [...actors.owned, ...actors.shared].some((r) => refKeys(r).includes(k));
}

export type ActorClass = "owned" | "shared" | "unknown";

/** Owned and shared actors as sets of Apify ids, names resolved to ids once. */
export interface ResolvedActors {
  owned: Set<string>;
  shared: Set<string>;
  /** Names that could not be resolved to an id, with why. */
  unresolved: string[];
}

const resolvedNames = new Map<string, string>();

/**
 * Resolves every listed name to its Apify id (GET /v2/acts/user~name, data.id),
 * caching each answer for the life of the process. A name that cannot be
 * resolved matches nothing, so its runs go to review rather than being guessed.
 */
export async function resolveActors(actors: ApifyActors, lookup: (name: string) => Promise<string | null>): Promise<ResolvedActors> {
  const unresolved: string[] = [];
  const ids = async (list: readonly ApifyActorRef[]) => {
    const out = new Set<string>();
    for (const r of list) {
      if (r.id) out.add(r.id);
      if (!r.name) continue;
      const name = normActor(r.name);
      let id = resolvedNames.get(name) ?? null;
      if (!id) {
        try {
          id = await lookup(name);
        } catch {
          id = null;
        }
        if (id) resolvedNames.set(name, id);
      }
      if (id) out.add(id);
      else if (!r.id) unresolved.push(name);
    }
    return out;
  };
  const owned = await ids(actors.owned);
  const shared = await ids(actors.shared);
  // An actor on both lists is shared: a run is never claimed when another tool may own it.
  for (const id of shared) owned.delete(id);
  return { owned, shared, unresolved };
}

export function classifyActor(resolved: ResolvedActors, actId: string): ActorClass {
  if (resolved.shared.has(actId)) return "shared";
  if (resolved.owned.has(actId)) return "owned";
  return "unknown";
}

/** Tests reset the name cache. */
export function clearActorCache(): void {
  resolvedNames.clear();
}

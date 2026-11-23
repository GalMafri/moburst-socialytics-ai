/**
 * The whole Socialytics route table in one place, the OpenAPI document
 * generated from it, and the request handler index.ts serves. index.ts
 * builds the deps; the contract test builds stubs; both get the same routes.
 */
import { handleRequest, type CoreDeps } from "../_shared/api/core.ts";
import { bearerFrom } from "../_shared/api/keys.ts";
import { buildOpenApi, type Route } from "../_shared/api/router.ts";
import { adminRoutes, type KeyStore } from "./routes-admin.ts";
import { demoRoutes, type DemoDeps } from "./routes-demo.ts";
import { meRoutes, type MeDeps } from "./routes-me.ts";
import { readRoutes, type ReadDeps } from "../_shared/socialytics-api/routes-read.ts";
import { systemRoutes } from "./routes-system.ts";
import { SCHEMAS } from "./schemas.ts";
import { PRICES } from "../_shared/cost/pricing.ts";
import { costRoutes, type CostStore } from "../_shared/cost/routes.ts";
import { actionRoutes, type ActionRunStore } from "../_shared/api/actions.ts";
import { socialyticsActions, type ActionAdapterDeps } from "../_shared/socialytics-api/actions.ts";

/** Answers every cost read with an error; only stubs (tests, the docs generator) build routes without a store. */
const NO_COST_STORE: CostStore = {
  summary: async () => { throw new Error("cost store not configured"); },
  events: async () => { throw new Error("cost store not configured"); },
};

const unconfigured = async (): Promise<never> => { throw new Error("actions not configured"); };
/** Answers every action with an error; only stubs (tests, the docs generator) build routes without them. */
const NO_ACTIONS: Omit<ActionAdapterDeps, "store"> = { call: unconfigured, actingUser: unconfigured, calendarPost: unconfigured };
const NO_ACTION_RUNS: ActionRunStore = { claim: unconfigured, finish: unconfigured, release: unconfigured };

export const API_VERSION = "1";
export const TOOL = "socialytics";

export interface AllDeps extends ReadDeps, DemoDeps, MeDeps {
  keys: KeyStore;
  serverUrl: string;
  /** cost_events reads (the cost routes); see _shared/cost/store.ts. */
  costs?: CostStore;
  /** What the public actions call (actions.ts), and where their idempotency keys are kept (action-runs-store.ts). */
  actions?: Omit<ActionAdapterDeps, "store">;
  actionRuns?: ActionRunStore;
  extraRoutes?: Route[];
}

/** The routes a person reaches with their sign-in session rather than a key (routes-me.ts). */
const SESSION_PATHS = "/v1/me/";

export function socialyticsOpenApi(routes: Route[], serverUrl: string): Record<string, unknown> {
  const doc = buildOpenApi(routes, {
    title: "Socialytics API", version: API_VERSION, serverUrl,
    description: "Everything Socialytics holds for the clients a key may see (clients with their brand, pillars and design, social and competitive reports with their decks, competitor sets, generated posts and media, schedules, scheduled posts, competitive alerts, design systems, Sprout performance, health), the actions people start in the app (start a social or competitive report, draft a post, write a post's copy again, start a post's designs, propose competitors, refresh the competitor feed, plan a calendar week; the run scope, with an optional idempotency_key), plus the ad-hoc demo job that onboards any brand from a name and a website and runs every feature for it, and what Socialytics' paid providers cost per client, service and period (the costs scope). Authenticate with `Authorization: Bearer <key>`. The personal key routes under /v1/me take a Socialytics sign-in session instead, for Moburst staff only. Lists are paginated with `limit` and `cursor`.",
  }, SCHEMAS) as { paths: Record<string, Record<string, Record<string, unknown>>>; components: { securitySchemes: Record<string, unknown> } };
  // The core documents security only for the routes it authenticates, and these it hands to their handlers ("none").
  doc.components.securitySchemes.Session = { type: "http", scheme: "bearer", description: "A Socialytics sign-in session token, for Moburst staff only." };
  for (const [path, operations] of Object.entries(doc.paths)) {
    if (!path.startsWith(SESSION_PATHS)) continue;
    for (const operation of Object.values(operations)) operation.security = [{ Session: [] }];
  }
  return doc;
}

export function socialyticsRoutes(deps: AllDeps): Route[] {
  let all: Route[] = [];
  const system = systemRoutes({ tool: TOOL, version: API_VERSION, openapi: () => socialyticsOpenApi(all, deps.serverUrl) });
  all = [...system, ...readRoutes(deps), ...actionRoutes(socialyticsActions({ store: deps.store, ...(deps.actions ?? NO_ACTIONS) }), { runs: deps.actionRuns ?? NO_ACTION_RUNS }), ...demoRoutes(deps), ...adminRoutes({ keys: deps.keys, tool: "soc" }), ...meRoutes(deps), ...costRoutes({ tool: TOOL, store: deps.costs ?? NO_COST_STORE, prices: PRICES }), ...(deps.extraRoutes ?? [])];
  return all;
}

/**
 * The api function's request handler. The route table is built for each
 * request, so the personal key routes read that request's own bearer: the
 * core's route context carries no headers, and requests run concurrently, so
 * no token is ever kept where another request could read it.
 */
export function socialyticsHandler(core: Omit<CoreDeps, "routes">, deps: Omit<AllDeps, "sessionToken">): (req: Request) => Promise<Response> {
  return (req) => handleRequest(req, { ...core, routes: socialyticsRoutes({ ...deps, sessionToken: () => bearerFrom(req.headers) }) });
}

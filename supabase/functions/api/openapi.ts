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

export const API_VERSION = "1";
export const TOOL = "socialytics";

export interface AllDeps extends ReadDeps, DemoDeps, MeDeps {
  keys: KeyStore;
  serverUrl: string;
  extraRoutes?: Route[];
}

export function socialyticsOpenApi(routes: Route[], serverUrl: string): Record<string, unknown> {
  return buildOpenApi(routes, {
    title: "Socialytics API", version: API_VERSION, serverUrl,
    description: "Everything Socialytics holds for the clients a key may see (clients with their brand, pillars and design, social and competitive reports with their decks, competitor sets, generated posts and media, schedules, scheduled posts, competitive alerts, design systems, Sprout performance, health), plus the ad-hoc demo job that onboards any brand from a name and a website and runs every feature for it. Authenticate with `Authorization: Bearer <key>`. Lists are paginated with `limit` and `cursor`.",
  }, SCHEMAS);
}

export function socialyticsRoutes(deps: AllDeps): Route[] {
  let all: Route[] = [];
  const system = systemRoutes({ tool: TOOL, version: API_VERSION, openapi: () => socialyticsOpenApi(all, deps.serverUrl) });
  all = [...system, ...readRoutes(deps), ...demoRoutes(deps), ...adminRoutes({ keys: deps.keys, tool: "soc" }), ...meRoutes(deps), ...(deps.extraRoutes ?? [])];
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

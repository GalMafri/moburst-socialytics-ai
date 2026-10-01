/**
 * The whole Socialytics route table in one place, and the OpenAPI document
 * generated from it. index.ts builds the deps; the contract test builds
 * stubs; both get the same routes.
 */
import { buildOpenApi, type Route } from "../_shared/api/router.ts";
import { adminRoutes, type KeyStore } from "./routes-admin.ts";
import { demoRoutes, type DemoDeps } from "./routes-demo.ts";
import { readRoutes, type ReadDeps } from "./routes-read.ts";
import { systemRoutes } from "./routes-system.ts";
import { SCHEMAS } from "./schemas.ts";

export const API_VERSION = "1";
export const TOOL = "socialytics";

export interface AllDeps extends ReadDeps, DemoDeps {
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
  all = [...system, ...readRoutes(deps), ...demoRoutes(deps), ...adminRoutes({ keys: deps.keys, tool: "soc" }), ...(deps.extraRoutes ?? [])];
  return all;
}

/** Liveness and the OpenAPI document, both open; the status route lives with the reads. */
import type { Route } from "../_shared/api/router.ts";
import { BUILD_STAMP } from "./build-stamp.ts";

export function systemRoutes(deps: { tool: string; version: string; openapi(): unknown }): Route[] {
  return [
    { method: "GET", path: "/v1/health", auth: "none", doc: { summary: "Liveness, and the build of the API function that answered", tag: "System", response: "Health" }, handler: async () => ({ status: 200, body: { ok: true, tool: deps.tool, version: deps.version, build: BUILD_STAMP, time: new Date().toISOString() } }) },
    { method: "GET", path: "/v1/openapi.json", auth: "none", doc: { summary: "This API's OpenAPI document", tag: "System", response: "Empty" }, handler: async () => ({ status: 200, body: deps.openapi() }) },
  ];
}

/**
 * The connector's tools, in one list, in the order they are offered: who is
 * offered each one, what it runs, and the manifest `npm run api:gen` writes
 * from it (api/mcp/socialytics-tools.json). Each tool's own definition stays
 * beside the code that runs it (tools.ts, reads.ts, writes.ts, tasks.ts);
 * this file decides the list.
 *
 * Two kinds of caller, one list:
 *   - a person signed in through Claude (OAuth): everyone gets the reads; Moburst
 *     staff also the strategy and notes reads, the saves and the work tools;
 *     admins also the cost summary;
 *   - a machine client (AgentBurst, Mobi) with a Socialytics API key as its
 *     bearer: the tools its key's scopes allow (read, run, costs), with its
 *     client reach. The person's own reads and the saves need a person, so a
 *     key is not offered them.
 *
 * mcp-catalog.test.ts fails when a public action is reached by no tool and is
 * not listed in API_ONLY (tasks.ts), or when the manifest is stale.
 */
import { z } from "npm:zod@4.6.7";
import type { Scope } from "../_shared/api/router.ts";
import type { Role } from "./access.ts";
import { READ_TOOLS, type Annotations } from "./reads.ts";
import { API_ONLY, API_TOOLS, COST_TOOL, WORK_TOOLS } from "./tasks.ts";
import { TOOLS } from "./tools.ts";
import { WRITE_TOOLS } from "./writes.ts";

/** How a tool runs (server.ts picks the runner by it). */
export type ToolKind = "read" | "person_read" | "save" | "api" | "work" | "cost";
/** Which signed-in people are offered it. */
export type Audience = "everyone" | "staff" | "admin";

export interface CatalogTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: Annotations;
  kind: ToolKind;
  /** The people offered it through OAuth. */
  person: Audience;
  /** The key scope that offers it to an API key; null when only a signed-in person can use it. */
  key: Scope | null;
  /** What it runs: "GET /v1/..." for a route, "action:<name>" for a public action, "person" for the person's own reads and saves. */
  uses: string[];
}

const READ_USES: Record<string, string[]> = {
  socialytics_clients_list: ["GET /v1/clients"], socialytics_client_get: ["GET /v1/clients/:id"], socialytics_reports_list: ["GET /v1/reports"], socialytics_report_get: ["GET /v1/reports/:id"],
  socialytics_competitive_reports_list: ["GET /v1/competitive-reports"], socialytics_competitive_report_get: ["GET /v1/competitive-reports/:id"], socialytics_client_analytics: ["GET /v1/clients/:id/analytics"],
  socialytics_trend_themes: ["trend_themes_in_range"],
};

export const CATALOG: CatalogTool[] = [
  ...TOOLS.map((t): CatalogTool => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, kind: "read", person: "everyone", key: "read", uses: READ_USES[t.name] ?? [] })),
  ...READ_TOOLS.map((t): CatalogTool => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, kind: "person_read", person: t.staffOnly ? "staff" : "everyone", key: null, uses: ["person"] })),
  ...WRITE_TOOLS.map((t): CatalogTool => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, kind: "save", person: "staff", key: null, uses: ["person"] })),
  ...API_TOOLS.map((t): CatalogTool => ({ ...t, kind: "api", person: "everyone", key: "read" })),
  ...WORK_TOOLS.map((t): CatalogTool => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, kind: "work", person: "staff", key: "run", uses: t.uses })),
  { ...COST_TOOL, kind: "cost", person: "admin", key: "costs" },
];

export { API_ONLY };

const RANK: Record<Role, number> = { admin: 3, moburst_user: 2, client: 1 };
const NEEDS: Record<Audience, number> = { admin: 3, staff: 2, everyone: 1 };

/** The tools a signed-in person is offered, in order. */
export const toolsForPerson = (role: Role): CatalogTool[] => CATALOG.filter((t) => RANK[role] >= NEEDS[t.person]);

/** The tools an API key is offered, in order. */
export const toolsForKey = (scopes: Scope[]): CatalogTool[] => CATALOG.filter((t) => t.key !== null && scopes.includes(t.key));

/** api/mcp/socialytics-tools.json, written by npm run api:gen. */
export function mcpManifest(mcpUrl: string, apiUrl: string): Record<string, unknown> {
  return {
    name: "socialytics",
    description: "Socialytics, Moburst's organic social tool, as a remote MCP server (Streamable HTTP). Generated from supabase/functions/mcp/catalog.ts by `npm run api:gen`; do not edit by hand.",
    server: mcpUrl,
    transport: "streamable-http",
    auth: {
      oauth: "Claude connectors sign in as the person through the project's Supabase Auth (OAuth 2.1): everyone reaches the clients they see in Socialytics; Moburst staff also save and start work; admins also read costs.",
      bearer: "Machine clients send a Socialytics API key as Authorization: Bearer <key>; the key's scopes and client reach apply.",
      scopes: { read: "the reads and socialytics_api", run: "the work tools (two-step: an estimate and a confirm_token first)", costs: "socialytics_cost_summary" },
    },
    rest_api: apiUrl,
    tools: CATALOG.map((t) => {
      const { $schema: _s, ...inputSchema } = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
      return { name: t.name, title: t.title, description: t.description, offered_to: { people: t.person, key_scope: t.key }, uses: t.uses, annotations: t.annotations, inputSchema };
    }),
    api_only_actions: API_ONLY,
  };
}

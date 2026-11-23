import { describe, expect, it } from "vitest";
import { emptyData, makeFakeStore } from "../_shared/socialytics-api/store.fake";
import { socialyticsActions } from "../../functions/_shared/socialytics-api/actions";
import { API_ONLY, CATALOG, mcpManifest, toolsForKey, toolsForPerson } from "../../functions/mcp/catalog";
import { WORK_TOOLS } from "../../functions/mcp/tasks";
import { stubRoutes } from "../api/stub";

const unconfigured = async (): Promise<never> => { throw new Error("not called"); };
const actionNames = socialyticsActions({ store: makeFakeStore(emptyData()), call: unconfigured, actingUser: unconfigured, calendarPost: unconfigured }).map((d) => d.name);

describe("the connector's tool list", () => {
  it("has unique names, each described for an agent", () => {
    expect(new Set(CATALOG.map((t) => t.name)).size).toBe(CATALOG.length);
    for (const t of CATALOG) {
      expect(t.name, t.name).toMatch(/^socialytics_[a-z_]+$/);
      expect(t.description.length, t.name).toBeGreaterThan(60);
      expect(t.annotations.readOnlyHint, t.name).toBe(t.kind !== "save" && t.kind !== "work");
    }
  });

  it("keeps the work tools few, each a two-step task on a public action", () => {
    expect(WORK_TOOLS.length).toBeLessThanOrEqual(8);
    for (const t of WORK_TOOLS) {
      expect(Object.keys(t.inputSchema.shape), t.name).toEqual(expect.arrayContaining(["client_id", "confirm_token"]));
      expect(t.description, t.name).toMatch(/confirm_token/);
    }
  });

  it("reaches every public action with a tool, or lists it as API-only with a reason", () => {
    const used = new Set(CATALOG.flatMap((t) => t.uses).filter((u) => u.startsWith("action:")).map((u) => u.slice(7)));
    const unreached = actionNames.filter((n) => !used.has(n) && !API_ONLY[n]);
    expect(unreached, "Give the action a work tool in supabase/functions/mcp/tasks.ts, or list it in API_ONLY there with the reason").toEqual([]);
    for (const [name, reason] of Object.entries(API_ONLY)) {
      expect(actionNames, `API_ONLY names ${name}, which is not a public action`).toContain(name);
      expect(used.has(name), `${name} is both API-only and used by a tool`).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("uses only actions and routes that exist", () => {
    const routes = stubRoutes();
    for (const t of CATALOG) for (const u of t.uses) {
      if (u.startsWith("action:")) expect(actionNames, `${t.name} uses ${u}`).toContain(u.slice(7));
      else if (/^GET \/v1\/[a-z]/.test(u)) expect(routes.some((r) => `${r.method} ${r.path}` === u), `${t.name} uses ${u}`).toBe(true);
    }
  });

  it("offers each caller its own tools: a client user reads, staff save and work, an admin also reads costs; a key by its scopes", () => {
    const client = toolsForPerson("client").map((t) => t.name);
    expect(client).not.toContain("socialytics_note_save");
    expect(client).not.toContain("socialytics_post_draft");
    expect(client).toContain("socialytics_api");
    expect(toolsForPerson("moburst_user").map((t) => t.name)).not.toContain("socialytics_cost_summary");
    expect(toolsForPerson("admin").map((t) => t.name)).toEqual(CATALOG.map((t) => t.name));
    expect(toolsForKey(["read"]).every((t) => t.kind === "read" || t.kind === "api")).toBe(true);
    expect(toolsForKey(["read", "run", "costs"]).some((t) => t.kind === "save" || t.kind === "person_read")).toBe(false);
  });

  it("is written to the manifest with every tool, its JSON Schema and the API-only actions", () => {
    const m = mcpManifest("https://x/functions/v1/mcp", "https://x/functions/v1/api") as { tools: Array<{ name: string; inputSchema: { type: string; properties: Record<string, unknown> } }>; api_only_actions: unknown };
    expect(m.tools.map((t) => t.name)).toEqual(CATALOG.map((t) => t.name));
    expect(m.tools.find((t) => t.name === "socialytics_report_get")!.inputSchema.properties).toHaveProperty("sections");
    for (const t of m.tools) expect(t.inputSchema.type, t.name).toBe("object");
    expect(m.api_only_actions).toEqual(API_ONLY);
  });
});

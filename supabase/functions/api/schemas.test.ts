import { describe, it, expect } from "vitest";
import { SCHEMAS } from "./schemas";

const FORBIDDEN = ["sprout_profile_id", "sprout_customer_id", "landscape_id", "rivaliq_landscape_id", "rivaliq_company_id", "company_id", "request_id", "model_path", "key_hash", "refresh_token", "access_token", "app_settings"];

function walk(node: unknown, path: string, out: string[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, out));
  const o = node as Record<string, unknown>;
  if (o.properties && typeof o.properties === "object") {
    for (const name of Object.keys(o.properties as object)) {
      if (FORBIDDEN.includes(name)) out.push(`${path}.${name}`);
      walk((o.properties as Record<string, unknown>)[name], `${path}.${name}`, out);
    }
  }
  for (const k of ["items", "additionalProperties", "oneOf", "anyOf", "allOf"]) if (o[k]) walk(o[k], `${path}.${k}`, out);
}

describe("response schemas", () => {
  it("never expose an internal identifier", () => {
    const hits: string[] = [];
    for (const [name, schema] of Object.entries(SCHEMAS)) walk(schema, name, hits);
    expect(hits).toEqual([]);
  });
  it("document the setup issue kinds and the design field as the serializer answers them", () => {
    const issue = SCHEMAS.SetupIssue as { properties: { kind: { enum: string[] } } };
    expect(issue.properties.kind.enum).toEqual(["brand_identity_missing", "pillars_missing", "keywords_missing", "sprout_missing", "competitors_missing", "design_style_missing", "schedule_missing"]);
    const design = (SCHEMAS.ClientObject as { properties: { design: { properties: Record<string, { type?: unknown; enum?: unknown[] }> } } }).properties.design.properties;
    expect(Object.keys(design)).toEqual(["synthesis_at", "references", "system", "ready", "waiting_for"]);
    expect(design.ready.type).toBe("boolean");
    expect(design.waiting_for.enum).toEqual(["look", "designed_posts", "social_accounts", "logo_file", null]);
  });
  it("cover every documented response", () => {
    for (const name of ["ClientList", "Client", "Setup", "Analytics", "ReportList", "Report", "CompetitiveReportList", "CompetitiveReport", "CompetitorSetList", "CompetitorSet", "PostList", "Post", "MediaJobList", "ScheduleList", "ScheduledPostList", "AlertList", "DesignSystemList", "Status", "Health", "DemoInput", "DemoJob", "DemoJobList", "ApiKeyCreate", "ApiKeyCreated", "ApiKeyList", "Empty", "Discarded"]) {
      expect(SCHEMAS[name], name).toBeDefined();
    }
  });
});

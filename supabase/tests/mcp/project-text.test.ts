// @vitest-environment node
// The text the team puts into Claude (src/lib/claudeProject.ts) names only
// tools the connector offers, and each save it asks for is one staff see.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DECK_SKILL_SECTION, knowledgePrompt, PLACEHOLDER_CLIENT, projectInstruction } from "../../../src/lib/claudeProject";
import { ROLE_RANK } from "../../../src/lib/roles";
import { RANK } from "../../functions/mcp/access";
import { READ_TOOLS } from "../../functions/mcp/reads";
import { TOOLS } from "../../functions/mcp/tools";
import { WRITE_TOOLS } from "../../functions/mcp/writes";

describe("the Claude project text", () => {
  it("names only tools the connector offers", () => {
    const offered = new Set([...TOOLS, ...READ_TOOLS, ...WRITE_TOOLS].map((t) => t.name));
    const named = new Set([projectInstruction(PLACEHOLDER_CLIENT), knowledgePrompt(PLACEHOLDER_CLIENT), DECK_SKILL_SECTION].join("\n").match(/socialytics_\w+/g));
    expect([...named].sort()).toEqual([
      "socialytics_calendar_posts", "socialytics_client_notes", "socialytics_clients_list", "socialytics_note_save", "socialytics_post_copy_save",
      "socialytics_report_deck_save", "socialytics_report_deck_upload", "socialytics_report_get", "socialytics_reports_list", "socialytics_strategy_get", "socialytics_strategy_section_save",
    ]);
    for (const n of named) expect(offered.has(n), n).toBe(true);
  });

  it("the access comments describe the current rule, not company-restricted staff", () => {
    for (const f of ["supabase/functions/_shared/auth/requireStaff.ts", "supabase/functions/mcp/access.ts"]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/company-restricted staff|company-scoped staff|company-\s*restricted staff/);
    }
  });

  it("the connector admits the same roles in the same order as the app", () => {
    expect([...RANK]).toEqual([...ROLE_RANK]);
  });
});

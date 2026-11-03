// @vitest-environment node
// The text the team puts into Claude (src/lib/claudeProject.ts) names only
// tools the connector offers, and each save it asks for is one staff see.
import { describe, expect, it } from "vitest";
import { DECK_SKILL_SECTION, knowledgePrompt, PLACEHOLDER_CLIENT, projectInstruction } from "../../../src/lib/claudeProject";
import { READ_TOOLS } from "./reads";
import { TOOLS } from "./tools";
import { WRITE_TOOLS } from "./writes";

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
});

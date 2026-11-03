// @vitest-environment node
// The text the team puts into Claude (src/lib/claudeProject.ts): Client setup
// fills in the client's name and id, the team setup guide shows the same
// text with placeholders, and every Socialytics tool it names is one the
// connector offers.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECK_SKILL_SECTION, knowledgePrompt, PLACEHOLDER_CLIENT, projectInstruction, SOCIALYTICS_HOST } from "@/lib/claudeProject";
import { TOOLS } from "../../supabase/functions/mcp/tools";
import { READ_TOOLS } from "../../supabase/functions/mcp/reads";
import { WRITE_TOOLS } from "../../supabase/functions/mcp/writes";

const BADER = { name: "Bader Law", id: "00000000-0000-4000-8000-000000000001" };
const guide = readFileSync(join(__dirname, "..", "..", "docs", "superpowers", "specs", "2026-11-03-claude-sync-team-setup.md"), "utf8");
const design = readFileSync(join(__dirname, "..", "..", "docs", "superpowers", "specs", "2026-11-03-claude-sync-design.md"), "utf8");
const blocks = (md: string) => [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
const texts = [projectInstruction(BADER), knowledgePrompt(BADER), DECK_SKILL_SECTION];

describe("the Claude project text", () => {
  it("names the client and its id in the instruction and the one-time prompt", () => {
    expect(projectInstruction(BADER)).toMatch(/^This project is for the Socialytics client Bader Law, client id 00000000-0000-4000-8000-000000000001\. Use this id with every Socialytics tool/);
    expect(knowledgePrompt(BADER).split("\n")[0]).toBe("Send this project's knowledge to Socialytics for Bader Law (client id 00000000-0000-4000-8000-000000000001).");
    expect(knowledgePrompt(BADER)).toContain('add "(partial)" to its title');
  });

  it("is the text the setup guide and the design give, placeholders and all", () => {
    const shown = [projectInstruction(PLACEHOLDER_CLIENT), knowledgePrompt(PLACEHOLDER_CLIENT), DECK_SKILL_SECTION];
    expect(blocks(guide)).toEqual(shown);
    expect(blocks(design)).toEqual(shown);
  });

  it("names only tools the connector offers", () => {
    const offered = new Set([...TOOLS, ...READ_TOOLS, ...WRITE_TOOLS].map((t) => t.name));
    const named = new Set(texts.join("\n").match(/socialytics_\w+/g));
    expect(named.size).toBeGreaterThan(8);
    for (const n of named) expect(offered.has(n), n).toBe(true);
  });

  it("reads plainly: no dashes as punctuation", () => {
    for (const t of [...texts, guide]) expect(t).not.toMatch(/—|–| - /);
  });

  it("gives Lital the one host to allow", () => {
    expect(SOCIALYTICS_HOST).toBe("rwouwxqggjjacbpbhqsn.supabase.co");
    expect(guide).toContain("`rwouwxqggjjacbpbhqsn.supabase.co`");
    expect(guide).toContain('"Package managers and specific domains"');
  });
});

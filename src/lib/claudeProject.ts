// The text the social team puts into Claude for two-way sync with Socialytics
// (docs/superpowers/specs/2026-11-03-claude-sync-design.md, "Text for the
// team's Claude projects"): each client project's instruction, the one-time
// prompt that sends a project's knowledge to Socialytics, and the Socialytics
// section of the two deck skills. Client setup shows the first two with the
// client's name and id filled in; the team setup guide
// (docs/superpowers/specs/2026-11-03-claude-sync-team-setup.md) carries all
// three with placeholders, and a test keeps the two the same.

export interface ClaudeProjectClient {
  name: string;
  id: string;
}

/** The placeholders the setup guide shows where Client setup fills in the client. */
export const PLACEHOLDER_CLIENT: ClaudeProjectClient = { name: "[Client name]", id: "[client id]" };

/** The host Claude's code sandbox must be allowed to reach for deck files (Organization settings > Capabilities). */
export const SOCIALYTICS_HOST = "rwouwxqggjjacbpbhqsn.supabase.co";

/** The instruction for one client's Claude project. */
export function projectInstruction(c: ClaudeProjectClient): string {
  return [
    `This project is for the Socialytics client ${c.name}, client id ${c.id}. Use this id with every Socialytics tool, and never save anything from this project to another client.`,
    "",
    "Socialytics holds this client's current notes, strategy and calendar. Before writing copy, a strategy or a deck for this client, read them with socialytics_client_notes, socialytics_strategy_get and socialytics_calendar_posts. Where they differ from the files in this project, Socialytics is newer.",
    "",
    "Save to Socialytics as the work happens:",
    "- Client feedback, a meeting note or an instruction from the client, whether pasted, uploaded or told to you in this chat: save it with socialytics_note_save, in the client's own words, with the date it was said. Never save your own ideas or drafts as notes.",
    "- Copy I approve for a calendar post: socialytics_post_copy_save.",
    "- A strategy section I approve: socialytics_strategy_section_save.",
    "- A finished deck I approve: attach it to its report as the deck skill says.",
  ].join("\n");
}

/** The prompt run once in a client's project to send its knowledge to Socialytics. */
export function knowledgePrompt(c: ClaudeProjectClient): string {
  return [
    `Send this project's knowledge to Socialytics for ${c.name} (client id ${c.id}).`,
    "1. List every file in this project's knowledge with its name and the date it covers, taken from its name or its text.",
    "2. Leave out Socialytics' own reports and exports of Sprout or RivalIQ data, and tell me which files you left out.",
    "3. Oldest first, save each other file with socialytics_note_save: the file name as title, its date, and its full text exactly as written. Send a file longer than 20,000 characters in parts cut at paragraph breaks, titled \"[name] (part 1 of 3)\" and so on.",
    "4. Save this project's instructions, without the Socialytics lines, as one note titled \"Project instructions\".",
    "5. If you can see only part of a file, save what you can see and add \"(partial)\" to its title.",
    "6. Finish with a list of what was saved, what Socialytics already had, and any partial files.",
  ].join("\n");
}

/** The section added to the Social Monthly Client Deck skill and the Bader Law deck skill. */
export const DECK_SKILL_SECTION = [
  "## Socialytics",
  "Report data: when no report PDF is attached, read the report from Socialytics. Use the client id from the project instruction, or find it with socialytics_clients_list. Call socialytics_reports_list, take the report whose period covers the month asked for, then call socialytics_report_get. Use the numbers exactly as Socialytics gives them.",
  "",
  "Saving the deck: when the person says the deck is final, call socialytics_report_deck_upload with the client id, client name, report id and file name, run the upload command it returns on the .pptx, then call socialytics_report_deck_save with the client id, client name, report id, the deck's title and the deck id. If the person gives a Google Slides or Drive link instead, call socialytics_report_deck_save with the link.",
].join("\n");

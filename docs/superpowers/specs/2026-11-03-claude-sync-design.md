# Two-way sync between the team's Claude work and Socialytics

Status: design for Lital's review, 3 Nov 2026. Nothing is built. Branch `feat/claude-sync`. It replaces the one-time import of Claude project files planned in the client notes design. Decisions I made myself are marked (My call.).

Lital, 3 Nov: "i want to sync the team's work from claude automatically so they don't need to go back and forth."

## Decisions for Lital

1. **Approvals.** Copy and strategy saves replace text, so they are marked destructive and Claude asks before every one. Note and deck saves only add, so a person can set them to "Always allow" and notes then save as they come up. As Owner you can instead hold every Socialytics write tool at "Needs approval" for the organization. I recommend leaving notes and decks to each person.
2. **Deck files need one Owner setting.** Claude builds decks as .pptx in its code sandbox, which has no route to Socialytics by default. In Organization settings > Capabilities, choose "Package managers and specific domains" and add `rwouwxqggjjacbpbhqsn.supabase.co`. Without it, decks attach as Google Slides or Drive links only.
3. **Who sees attached decks.** My call: everyone who can see the report, the client included, since the tool takes finished decks only. The alternative is staff only.
4. **Large projects.** Socialytics cannot read a Claude project: no API exists for it on the Team plan. Claude sends the knowledge itself, and once a project is big enough that Claude searches it in pieces, it can't see whole files. My call: save what it sees, marked "(partial)". The alternative is a staff member dropping those files in Client setup once.
5. **Consent wording.** "It can't change anything" becomes: "Claude will be able to read reports, analytics, trends, the calendar and, for Moburst staff, client notes and the strategy. Staff can also save client notes, approved copy, strategy edits and finished decks." People already connected keep their connection and get the new tools in their next chat. (My call.)

## What moves where

From Claude into Socialytics (new):

| What | Where it lands | What follows |
|---|---|---|
| Client feedback, meeting notes and client instructions written or discussed in Claude | A typed client note, source `claude` | The `notes_read` job learns its points; copy follows them, and untouched posts in planned weeks get one rewrite, as notes added in the app already do |
| Copy the person approves for a calendar post | The post's copy (`post_iterations` row, `calendar_posts.copy`, `touched_at`) | Weekly revisions keep the post; the edit teaches the preference memory like an edit in the app |
| A strategy section the person approves | Their version of the section (`content_strategy_edits`) | Shown on the Strategy page; strategy rewrites keep it |
| A finished deck | `report_decks`, the file in a private bucket or a link | Listed on the social or competitive report |

From Socialytics into Claude: reports, analytics and trend themes as today, plus the calendar, the strategy and client notes.

## Tools the connector gains

The eight read tools stay. All new tools set `openWorldHint: false`.

Reads, `readOnlyHint: true`:

- `socialytics_calendar_posts` (`client_id`, `from`, `to`; default today to 28 days ahead): each post's key, date, time, platform, format, pillar, copy, hashtags, CTA, why it is planned (worded as on screen), whether someone worked on it, and `updated_at`.
- `socialytics_strategy_get` (`client_id`): each section as the page shows it (a person's version where one exists, with who and when), platform states, the written date, and a `version` per section.
- `socialytics_client_notes` (`client_id`, `note_id`): the points the copy follows now (`pointsInUse`, the function the screen and the voice block use) and the notes list (title, date, who added it, from Claude or the app, state). With `note_id`, that note's text.

Writes:

| Tool | Arguments | Hints | What it does |
|---|---|---|---|
| `socialytics_note_save` | `client_id`, `client_name`, `text` (up to 20,000 characters), `title`, `date` | destructive false, idempotent true | Adds one typed note. The same text again answers "Already saved on [date] by [name]." |
| `socialytics_post_copy_save` | `client_id`, `client_name`, `post_key`, `copy`, `hashtags`, `cta`, `based_on` | destructive true | Saves the copy as the calendar's Save does |
| `socialytics_strategy_section_save` | `client_id`, `client_name`, `section_key`, `text`, `based_on` | destructive true | Saves the person's version of one section; empty text is refused |
| `socialytics_report_deck_upload` | `client_id`, `client_name`, `report_id`, `file_name` (.pptx or .pdf) | destructive false | Returns a deck id and a one-time upload command for the file |
| `socialytics_report_deck_save` | `client_id`, `client_name`, `report_id`, `title`, `deck_id` or `link` | destructive false, idempotent true | Records the deck on the report once its file has arrived |

- Write tools are listed only for admins and Moburst staff, so a client user's Claude never sees them. The notes and strategy reads are staff only too. (My call.)
- No delete tools. Removing a note or point stays in Client setup, and handing a strategy section back stays on the Strategy page. (My call.)
- `client_name` must match the id's client name, ignoring case. The approval card Claude shows then names the client in words, and a mixed-up id is refused. (My call.)
- `based_on` is the `updated_at` or section `version` Claude read. If the post or section changed since, the tool refuses and returns the current text, so Claude shows it to the person and asks again. A save equal to what is stored changes nothing and says so. (My call.)
- Server `instructions` change to name the saves. I found nothing in Claude's documentation saying claude.ai reads them, so nothing depends on them; the project instruction and tool descriptions carry the behavior.

## How writes fit the database guards

The guards stay exactly as built. An OAuth session still cannot insert, update or delete any table or call any write function, so the token Claude holds stays read-only everywhere outside the connector, PostgREST included.

Writes happen only inside the `mcp` function, in one module, `mcp/writes.ts`, through the service role, after these checks in order:

1. The token verifies and the person is admitted, as today.
2. The person's role is admin or moburst_user, and `is_moburst_staff()` and `can_write_client(client_id)` answer true when called as the person. Both are reads, which an OAuth session may call. Removing access cuts writes at the next call.
3. `client_name` matches, and the report, post or section belongs to `client_id`.
4. The existing 120 calls a minute, plus at most 200 writes per client a day, counted from the audit rows. (My call.)

Each write then runs the code the app runs, moved to `_shared` so there is one path:

- Notes: `_shared/notes/add.ts`, taken out of `client-notes` `add_text`. `client_notes` gains `source` and `text_hash` (SHA-256 of the text with whitespace collapsed). A lookup across all of the client's notes, backed by a unique index on (`client_id`, `text_hash`) for Claude's notes, stops duplicates. A date Claude passes counts as a person's date, as the date field does in the app. (My call.)
- Copy: `_shared/calendar/saveCopy.ts`, taken out of `calendar-posts` `save_copy`, with the `based_on` check for the connector. `post_iterations.source` gains `claude`.
- Strategy: the body of `strategy_section_save` moves to `strategy_section_save_as(p_user, p_client, p_key, p_text, p_source, p_expected)`, executable by the service role only. With `p_expected` (the section's version as Claude read it) the check and the write happen in the same call, under a lock on the section and the strategy's row taken before the section is read; a section changed since is not written and the answer carries its current text and version (added 3 Nov, closing the gap between the connector's check and the save). `strategy_section_save` keeps its guards and calls it with `auth.uid()` and no `p_expected`. `content_strategy_edits` gains `source`.
- Decks: a new `report_decks` table (client, report, title, link or file path, type, source, added by and name, created at) and a private `report-decks` bucket (pptx and pdf, 50 MB). The upload tool signs one upload URL with Supabase Storage's `createSignedUploadUrl` for `{client_id}/{report_id}/{deck_id}.{ext}`, valid two hours. The save tool checks the file is there before writing the row. Links must be https. (My call.)

Every row written names the person (`added_by`, `created_by` or `edited_by`, with their display name) and `source = 'claude'`, so the app shows "From Claude, by Sinéad". Every tool call already writes an `api_requests` row with the person, the OAuth client and the client; a new `target` column records what was written (note id, post key, section key, deck id), never the text. The 180-day purge covers these rows.

## Which client a chat is about

1. In a client's project, the project instruction names the client and its Socialytics id (text below), and Claude passes that id to every tool.
2. Outside a project, Claude finds the client with `socialytics_clients_list` from the name the person used and asks when more than one matches. The tool descriptions say this.
3. The server checks `client_name` against the id and the target against the client, so a wrong id is refused.

Client setup gets a staff-only "Claude" panel with that client's project instruction and one-time prompt, name and id filled in, each with a Copy button. `src/lib/claudeProject.ts` holds the text for the panel and the tests. (My call.) Pasting the instruction into the project is the one step left to the team, because Claude offers no API that writes or reads a Team plan project.

## Bringing in what a project already holds

Socialytics has no way to read a claude.ai project. The only Anthropic API that reaches project content is the Compliance API, which serves Enterprise organizations for audit and compliance; the Team plan has no access, and the help center's projects article describes no export. Claude can read its own project's knowledge, so the team runs the one-time prompt below once per project. Notes are matched by text, so a rerun, or a note saved again later, adds nothing. The `notes_read` job reads them in the order saved, and a later note outdates an earlier one by date, as the notes design already does. Reading cost is the notes design's: about $0.04 for a 20,000-character file.

The limit: the help center says a paid-plan project switches to retrieval as its knowledge nears the context limit. Claude then sees files in pieces, so the prompt saves what it sees marked "(partial)" and lists those files (Decision 4).

## Conflicts and duplicates

- The same note twice (a retry, a rerun, two people): one row, and the second call says who saved it and when.
- Notes that disagree: the notes reader links them and the later date wins, worked out at every read.
- Copy or strategy changed in the app while Claude worked: `based_on` refuses the older save and returns the current text.
- Weekly revisions keep a post whose copy came from Claude (`touched_at`); strategy rewrites never touch people's versions.
- A deck saved twice is one row per link or deck id; several decks on a report list newest first.

## Security

- Staff only, and only their clients: company-restricted staff write only to their companies, since every write needs `can_write_client`.
- Every write is logged (person, tool, client, target), and the row itself names the person and Claude as its source.
- The client never sees internal notes. The notes tables and bucket stay `can_write_client` only, the notes read tool is staff only and runs as the person, and copy written from notes never says where a fact came from (the voice block rule).
- Prompt injection: pasted client feedback can carry instructions. The write tools reach Socialytics only, only clients the person can write to, delete nothing, and copy and strategy saves always ask. Tool descriptions state what each tool does and never tell Claude how to behave, as Claude's connector review checklist requires.
- An upload URL lets one file be put at one path for two hours. The deck appears only after the save call by an admitted person.
- The new table and bucket get the three "OAuth sessions cannot ..." policies (`schema-guards.test.ts` already requires them), and a new static test fails if any connector module other than `writes.ts` and the audit wiring can reach the service-role client.

## Text for the team's Claude projects

Project instruction, one per client project (Socialytics fills in the name and id):

```
This project is for the Socialytics client [Client name], client id [client id]. Use this id with every Socialytics tool, and never save anything from this project to another client.

Socialytics holds this client's current notes, strategy and calendar. Before writing copy, a strategy or a deck for this client, read them with socialytics_client_notes, socialytics_strategy_get and socialytics_calendar_posts. Where they differ from the files in this project, Socialytics is newer.

Save to Socialytics as the work happens:
- Client feedback, a meeting note or an instruction from the client, whether pasted, uploaded or told to you in this chat: save it with socialytics_note_save, in the client's own words, with the date it was said. Never save your own ideas or drafts as notes.
- Copy I approve for a calendar post: socialytics_post_copy_save.
- A strategy section I approve: socialytics_strategy_section_save.
- A finished deck I approve: attach it to its report as the deck skill says.
```

One-time prompt, run once in each project:

```
Send this project's knowledge to Socialytics for [Client name] (client id [client id]).
1. List every file in this project's knowledge with its name and the date it covers, taken from its name or its text.
2. Leave out Socialytics' own reports and exports of Sprout or RivalIQ data, and tell me which files you left out.
3. Oldest first, save each other file with socialytics_note_save: the file name as title, its date, and its full text exactly as written. Send a file longer than 20,000 characters in parts cut at paragraph breaks, titled "[name] (part 1 of 3)" and so on.
4. Save this project's instructions, without the Socialytics lines, as one note titled "Project instructions".
5. If you can see only part of a file, save what you can see and add "(partial)" to its title.
6. Finish with a list of what was saved, what Socialytics already had, and any partial files.
```

## Deck skill changes

Add this section to the Social Monthly Client Deck skill and the Bader Law deck skill. Neither skill is on this Mac (they are in the social team's Claude account), so placement is for whoever edits them. The `bader-law-design` skill on this Mac builds decks as .pptx with `decks/build_deck.py` and tells the person to upload them to Drive; this section replaces that hand step.

```
## Socialytics
Report data: when no report PDF is attached, read the report from Socialytics. Use the client id from the project instruction, or find it with socialytics_clients_list. Call socialytics_reports_list, take the report whose period covers the month asked for, then call socialytics_report_get. Use the numbers exactly as Socialytics gives them.

Saving the deck: when the person says the deck is final, call socialytics_report_deck_upload with the client id, client name, report id and file name, run the upload command it returns on the .pptx, then call socialytics_report_deck_save with the client id, client name, report id, the deck's title and the deck id. If the person gives a Google Slides or Drive link instead, call socialytics_report_deck_save with the link.
```

## Tests

- `mcp/writes.test.ts` (fake store, injected service writer): each tool writes its row with the person and `source = 'claude'`; a client user and staff without access are refused; a target of another client, a wrong `client_name`, a stale `based_on`, empty strategy text, a deck save before its file arrives and a non-https link are refused with one plain sentence; the same note twice makes one row; the 201st write for a client in a day is refused; the audit row carries `target` and no text.
- `mcp/server.test.ts`: `tools/list` for staff returns 16 tools with the hints above; for a client user, 9 read tools.
- `mcp/reads.test.ts`: calendar, strategy and notes as the person; notes and strategy read as not found for a client user.
- `_shared/notes/add.test.ts` and `_shared/calendar/saveCopy.test.ts`: `client-notes` and `calendar-posts` write the same rows as before the move.
- SQL (PGlite): an OAuth session still cannot write `client_notes`, `post_iterations`, `content_strategy_edits`, `report_decks` or `report-decks` objects; `strategy_section_save_as` refuses `authenticated`; `strategy_section_save` behaves as before.
- `schema-guards.test.ts` covers the new table; the new static test covers the service-role client.
- Acceptance on Sinéad's account: in the Bader Law project, a note saved from chat shows in Client setup as from Claude and is read into points; approved copy shows on the calendar; a deck attaches to the October report.

## Files

Create: `supabase/functions/mcp/writes.ts`, `mcp/reads.ts`, `_shared/notes/add.ts`, `_shared/calendar/saveCopy.ts`, each with its test; `supabase/migrations/<timestamp>_claude_sync.sql` (`client_notes.source` and `text_hash`, `post_iterations` source `claude`, `content_strategy_edits.source`, `strategy_section_save_as`, `report_decks` and the `report-decks` bucket with their policies, `api_requests.target`); `src/lib/claudeProject.ts` and its test; `src/components/onboarding/ClaudeProject.tsx`; `src/components/reports/ReportDecks.tsx`.

Change: `mcp/server.ts`, `tools.ts`, `audit.ts`, `index.ts`; `client-notes/index.ts`; `calendar-posts/index.ts`; `src/pages/OAuthConsent.tsx`, `ClientSetup.tsx`, `ReportView.tsx`, `CompetitiveReportView.tsx`, `ClientStrategy.tsx`; `src/components/onboarding/ClientNotes.tsx`; `src/lib/display.ts`; `src/integrations/supabase/types.ts`; `docs/api/SOCIALYTICS-API.md` (connector section); `scripts/smoke-prod.sh`. Outside the repo: the two deck skills, and Decisions 1 and 2 in Claude's organization settings.

## Sources (read 3 Nov 2026)

- Claude: [Build an MCP server for Claude](https://claude.com/docs/connectors/building) (result size and timeout), [Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria.md) (titles and hints; read-only tools run without per-call confirmation and destructive tools always prompt; separate read and write tools; descriptions say what a tool does), [Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164) (Owners on Team and Enterprise set Always allow, Needs approval or Blocked by tool category), [Manage custom roles on Enterprise plans](https://support.claude.com/en/articles/13930452) (a person's own "Always allow"), [Getting started with custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp), [How can I create and manage projects?](https://support.claude.com/en/articles/9519177) (instructions, knowledge, retrieval mode; no export or API), [Create files with Claude](https://support.claude.com/en/articles/12111783-create-files-with-claude) (.pptx output, network access options in Organization settings > Capabilities), [Create custom skills](https://claude.com/docs/skills/how-to.md) (a skill tells Claude how to use a connector), [Connectors, skills, and plugins](https://claude.com/docs/extend/overview.md).
- Anthropic Compliance API: [overview](https://platform.claude.com/docs/en/manage-claude/compliance-api) (project content for Enterprise only).
- MCP specification 2025-11-25: [ToolAnnotations](https://modelcontextprotocol.io/specification/2025-11-25/schema) (readOnlyHint, destructiveHint, idempotentHint, openWorldHint and their defaults).
- Supabase: [createSignedUploadUrl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) (valid two hours).
- Repo, read in full: `supabase/functions/mcp/*.ts`, `20261109120000_claude_connector.sql`, `20261109100000_client_notes.sql`, the content strategy migration's tables and `strategy_section_save`, `client-notes/index.ts`, `calendar-posts/index.ts`, the client notes and content strategy designs, and the connector design (it sits in the `socialytics-claude-connector` worktree, not on this branch). Not read: the team's two deck skills.

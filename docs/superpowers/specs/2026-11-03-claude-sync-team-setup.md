# Socialytics and Claude: setup for the social team

For Sinéad and Neria, 3 Nov 2026. Design: `2026-11-03-claude-sync-design.md`.

Claude and Socialytics now share the work in both directions. In a client's Claude project, Claude reads that client's notes, strategy and calendar from Socialytics before it writes, and it saves what you agree on back to Socialytics: client feedback and meeting notes, copy you approve for a calendar post, strategy sections you approve, and finished decks. You no longer copy things from one to the other by hand.

## What Lital does once (Owner)

So Claude can send a finished .pptx or .pdf deck to Socialytics from its file sandbox:

1. In Claude, open Organization settings, then Capabilities.
2. Under network access for code and files, choose "Package managers and specific domains".
3. Add this domain: `rwouwxqggjjacbpbhqsn.supabase.co`
4. Save.

Until this is set, decks can still be attached as a Google Slides or Drive link.

## What each of you does once

1. **Connect Socialytics in Claude.** If you connected it before, you are done: the new tools appear in your next chat. If not, open Customize > Connectors, click Connect next to Socialytics, and choose Allow on the Socialytics page that opens.
2. **Choose how Claude asks before saving.** Saving copy or a strategy section replaces text, so Claude asks you every time. Saving a note or attaching a deck only adds, so when Claude first asks for one of those you can choose Always allow for it. That is your choice; Claude still shows what it saved.

## For each client project in Claude (once per project)

1. In Socialytics, open the client's Client setup, then the Brief tab. The "Claude project" panel at the bottom has the client's project instruction and one-time prompt, with the client's name and id already filled in.
2. In the client's Claude project, open the project instructions and paste the project instruction there, below anything already in them. Click Copy in Socialytics to copy it.
3. Start a chat in the project and send the one-time prompt from the same panel. Claude saves the project's files to the client's notes in Socialytics and lists what it saved, what Socialytics already had, and any file it could only partly see (those are marked "(partial)"). Running it again later adds nothing that is already there.

After that, work in the project as usual. When the client gives feedback or you paste meeting notes, Claude saves them as a note. When you approve copy for a calendar post or a strategy section, Claude asks to save it and you approve.

## The deck skills (once, by whoever edits them)

Add the "Socialytics" section below to the Social Monthly Client Deck skill and to the Bader Law deck skill. With it, Claude reads the report from Socialytics when no report PDF is attached, and attaches the finished deck to the report in Socialytics when you say it is final. The Bader Law skill's step that tells you to upload the deck to Drive is no longer needed.

## What you will see in Socialytics

- **Client notes** (Client setup, Brief): a note saved from Claude says "From Claude, by" and your name. Socialytics then reads it like a note you add yourself, and every post written for the client follows what it says.
- **Calendar**: approved copy is on the post. The weekly revisions leave that post as it is.
- **Strategy**: a section saved from Claude shows as your version, "From Claude, by" and your name. Rewrites of the strategy keep it.
- **Reports**: an attached deck is listed on the social or competitive report. Anyone who can see the report can open it, the client included.

## What Claude cannot do

- Delete anything. Removing a note stays in Client setup, and going back to Socialytics' own version of a strategy section stays on the Strategy page.
- Save to a client you cannot change in Socialytics, or to a client other than the one it names. Every save names the client by id and by name, and Socialytics refuses a mismatch.
- Overwrite a change. If the post or the section changed in Socialytics after Claude read it, the save is refused and Claude shows you what it says now.
- Save from a client's own login. Clients who connect Claude can read their reports, analytics, trends and calendar, and save nothing.

## The texts

Socialytics fills in the client's name and id in Client setup. They are shown here with placeholders.

### Project instruction (one per client project)

```
This project is for the Socialytics client [Client name], client id [client id]. Use this id with every Socialytics tool, and never save anything from this project to another client.

Socialytics holds this client's current notes, strategy and calendar. Before writing copy, a strategy or a deck for this client, read them with socialytics_client_notes, socialytics_strategy_get and socialytics_calendar_posts. Where they differ from the files in this project, Socialytics is newer.

Save to Socialytics as the work happens:
- Client feedback, a meeting note or an instruction from the client, whether pasted, uploaded or told to you in this chat: save it with socialytics_note_save, in the client's own words, with the date it was said. Never save your own ideas or drafts as notes.
- Copy I approve for a calendar post: socialytics_post_copy_save.
- A strategy section I approve: socialytics_strategy_section_save.
- A finished deck I approve: attach it to its report as the deck skill says.
```

### One-time prompt (run once in each project)

```
Send this project's knowledge to Socialytics for [Client name] (client id [client id]).
1. List every file in this project's knowledge with its name and the date it covers, taken from its name or its text.
2. Leave out Socialytics' own reports and exports of Sprout or RivalIQ data, and tell me which files you left out.
3. Oldest first, save each other file with socialytics_note_save: the file name as title, its date, and its full text exactly as written. Send a file longer than 20,000 characters in parts cut at paragraph breaks, titled "[name] (part 1 of 3)" and so on.
4. Save this project's instructions, without the Socialytics lines, as one note titled "Project instructions".
5. If you can see only part of a file, save what you can see and add "(partial)" to its title.
6. Finish with a list of what was saved, what Socialytics already had, and any partial files.
```

### Section for the two deck skills

```
## Socialytics
Report data: when no report PDF is attached, read the report from Socialytics. Use the client id from the project instruction, or find it with socialytics_clients_list. Call socialytics_reports_list, take the report whose period covers the month asked for, then call socialytics_report_get. Use the numbers exactly as Socialytics gives them.

Saving the deck: when the person says the deck is final, call socialytics_report_deck_upload with the client id, client name, report id and file name, run the upload command it returns on the .pptx, then call socialytics_report_deck_save with the client id, client name, report id, the deck's title and the deck id. If the person gives a Google Slides or Drive link instead, call socialytics_report_deck_save with the link.
```

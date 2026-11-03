# Design references that refresh themselves

Status: design, 2 Nov 2026. Nothing is built. Asked for by the social team through Lital on 2 Nov: a client's design references should follow its latest post designs with no one stepping in, and every platform needs enough posts to learn its own design and copy.

## What the code does today

Design references

- The lifecycle step `design_refs` (supabase/functions/_shared/lifecycle/steps.ts:497-519) runs `learnBrandStyle` in discovery mode. Its inputs key is the client's active Sprout profiles plus its Sprout customer (steps.ts:499-504, brand-references/candidates.ts:38-40). Policy: `refreshDays: 90, recheckDays: 30` (steps.ts:498). A step runs again only when its key changes, a retry or recheck comes due, or the refresh period passes (lifecycle/policy.ts:54-65). There is a daily lifecycle tick and a trigger on Sprout profile changes (migrations/20261019180000_client_lifecycle.sql).
- "A reused design style keeps the date it was learned": with unchanged accounts, discovery returns the stored style and spends nothing (brand-references/discover.ts:57-59), and the step stores the style's `synthesized_at` as its `done_at` (steps.ts:509-510, policy.ts:84). The 90 days count from the last real learning, so no reuse can postpone them.
- Discovery reads at most 150 posts from the last 90 days, sorted by lifetime impressions (discover.ts:66-81); keeps feed photos and albums, one frame per post, no Stories, newest first (candidates.ts:14-31); reviews the first 24 with Claude Haiku 4.5 (discover.ts:84, 108-116); accepts confidence 0.8 or more (candidates.ts:33-36); keeps 8 across all platforms (discover.ts:7); needs 3 (discover.ts:10, 128).
- `learnStyle.ts` writes one rulebook from those 8 images with Claude Sonnet 4.6 (learnStyle.ts:99, 137) and replaces `design_style_synthesis` and `harvested_design_references` (learnStyle.ts:170-173). Its `platform_adaptations` field asks for Instagram, LinkedIn and TikTok rules whatever the client posts on (learnStyle.ts:45). Uploaded references are ignored in this mode (learnStyle.ts:89-92), and `referencesFor` drops them whenever reviewed posts exist (design-prompts/designRefs.ts:43-45).
- `design_settings` (steps.ts:752-791) copies the references into `design_brand_settings.reference_paths` through `lifecycle_write_design_settings`, which only updates rows whose source is `lifecycle` (migrations/20261019220000_lifecycle_steps.sql:221-232). The design pipeline plans from that list alone: up to 16 images labeled "Post 1, Post 2", with no platform or date (design-request/index.ts:303-312). The request's platform appears only in the prompt text (canva/options.ts:586-591).
- Staff have a "Refresh references" button that queues the step with force (src/components/onboarding/AutomaticBrandReferences.tsx:71-93, migrations/20261109120000_claude_connector.sql:225-249).

Why they look frozen

1. Only two things make `design_refs` due: the accounts change, or 90 days pass. New posts and a new look never do.
2. Sorting by lifetime impressions favors posts that have had longest to collect views, so the sample leans to the old end of the window, and every platform shares 8 slots.
3. The weekly competitor-feed harvest stops for any client with reviewed references (competitive/refreshFeed.ts:197-199), so the 90-day run is the only refresh.
4. Every settings row made before 19 Oct has source `person` (lifecycle_steps.sql:197), and any save on the Design settings card, even a logo nudge, marks the whole row `person` (lifecycle_steps.sql:204-215, DesignSettingsCard.tsx:201-213). From then on the design library never changes, even when `design_refs` learns new posts.
5. A refresh that finds fewer than 3 designed posts keeps the old set and looks again in 30 days (steps.ts:514).

Copy

- The voice is per platform already: `clients.social_voice` holds a profile and examples per platform (voice/voice.ts:35-62), and `voicePromptBlock` gives a writer only the platforms its copy is for, client notes included (voice.ts:78-120, 81).
- `buildVoiceProfile` (voice/load.ts:152-181) learns from the newest 25 posts per platform with 20 or more characters over 90 days. It has no minimum (one post makes a platform voice) and keeps boosted posts. The calendar's evidence leaves boosted posts out and calls a platform thin below 5 posts (calendar/evidence.ts:96-98, 165, 180).
- The profile is rebuilt when missing, or once a month when a week is planned (migrations/20261019140000_weekly_calendar.sql:159-166).
- `brand_voice_learnings` has no platform column (src/integrations/supabase/types.ts:240-254); a platform survives only inside the description text (voice.ts:201).

## The design

### When references refresh

- `design_refs` checks every week (`refreshDays: 7, recheckDays: 7`), and at once when the accounts change or a person keeps or leaves out a reference (choices and uploads join its inputs key). (My call.)
- A check is one Sprout read of the 90-day window, newest first, every page. Each post reviewed, accepted or not, is stored in a new table `design_reference_reviews`, so no post is sent to a model twice.
- New posts are reviewed with Haiku as today. The look is learned again only when the library changes by two or more posts, a platform reaches its minimum, or a person keeps or leaves out a post. Otherwise the check ends with no model call. (My call.)
- `done_at` becomes the check time. The learned date stays in the result's `synthesized_at`, which `design_settings` already keys on (steps.ts:763), so settings move only after a real relearn. The rule that a reused style keeps its date is retired: a weekly read of the posts replaces the 90-day clock.
- The "Refresh references" button goes. (My call.)

### Which posts count

- The client's own published posts on its assigned accounts in the last 90 days (the calendar's window, evidence.ts:97).
- Organic only: posts Sprout marks `is_boosted` are left out, as the calendar does.
- Designed posts only: feed photos and albums that pass the review. Text-only posts, links, Stories and videos are out; videos keep their own path (brand-references/videos.ts).
- Per platform, named the calendar's way (`platformName`, evidence.ts:108), newest first, up to 6 per platform and 16 overall, taken in turn across platforms. Kept posts come first.
- Age alone never shrinks a library below 3: an old post leaves only when a newer one replaces it. (My call.)

### Minimum valid sample per platform

- Design: 3 designed posts across the client to learn its look (today's rule), and 4 on one platform before that platform gets rules of its own. (My call.) Copy: 5 organic posts with text on one platform, the calendar's thin line.
- Below the minimum, a platform borrows. Its own posts lead its design library and the rest come from the client's other platforms, newest first. Its writer gets the brand's overall voice, labeled as learned from the other platforms, with the platform's own posts as examples.
- A client with fewer than 3 designed posts in all waits quietly, keeps its last references, and is checked weekly.
- Nothing is invented: the rulebook gets a section only for platforms that meet the minimum, and its prompt names only those.

### Newest posts lead, stable elements stay

- The rulebook prompt receives the library newest first, each image labeled with platform and date, plus the previous rulebook.
- It writes a core (logo treatment, type, palette, marks) and one section per qualified platform. A rule is current when the newest posts show it. A previous rule carries forward when the newest posts neither show nor contradict it, so a month without logos does not erase the logo rule.
- It returns `look_change`: whether the newest posts depart from the previous rulebook, since when, and what changed. This is the model reading the client's own posts; it only decides which posts lead and blocks nothing. (My call.)
- On a change, posts before it leave the library (kept posts stay), and `brand_read` becomes due so the logo file and colors follow a rebrand. Fields a person set are never replaced (lifecycle/fields.ts).

### How platform differences reach designs and copy

- `design_style_synthesis` gains `platforms: { name: { rules, posts, learned_at } }`; `platform_adaptations` is written from it for current readers.
- The library leaves the single `source` of `design_brand_settings`: a new function `lifecycle_write_design_library` writes `reference_paths` for every row, person or lifecycle. Logo, placement and background keep today's rule.
- `design-request` labels each image "Post 3 (LinkedIn, Oct 28, 2026, kept by the team)" and puts the request platform's posts first. The planner prompt says posts from other platforms show the brand, not that platform's layout. Every caller of `referencesFor` passes the post's platform.
- `buildVoiceProfile` leaves boosted posts out, writes a voice only for platforms with 5 posts, adds an overall voice from all platforms in the same call, and records thin platforms. The week plan queues an early rebuild when a thin platform reaches 5.
- `brand_voice_learnings` gets a nullable `platform`. The merge prompt says whether a preference is for one platform, and writers see all-platform preferences plus their own platform's. Existing rows stay all-platform.

### A person's choices

- New table `design_reference_choices` (client, path, kept or left out, who, when). A kept post stays in its platform's library past 90 days and through a look change; a post left out never returns. Uploads (`clients.design_references`) count as kept.
- A choice is saved at once, resent quietly on a dropped connection, and makes the step due.
- Existing saves (My call, the one point to confirm): posts a person left out on a saved row become "left out", uploads become "kept", and reviewed posts that were simply in a saved list are not kept forever, so those clients start refreshing. Keeping every saved post would leave them frozen until someone unpins by hand.

### What staff see on Client setup

The references card loses its button and shows plain status:

- "Checked for new posts Nov 2, 2026. Look learned Oct 28, 2026 from 11 posts."
- One line per platform: "Instagram: 6 posts, newest Oct 27." "LinkedIn: 2 posts. LinkedIn designs follow the Instagram look until there are 4."
- Copy: "TikTok: 3 posts. TikTok copy follows the brand's overall voice until there are 5."
- After a change: "New look in posts since Oct 20, 2026: [what changed]."
- Each thumbnail shows platform and date with Keep and Leave out; left-out posts sit in a closed list with "Use again". The Design settings card keeps logo, placement and background only.

Failures stay quiet: a failed check retries with the lifecycle's backoff, and the last references stay in use. Refreshing references never makes a design; automatic designs stay off.

### Cost

From list prices (Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, Opus 5.5 $4/$20 per million tokens) and about 1,600 tokens per image. Estimates, to check against usage after the first month.

- Weekly check: one Sprout read, no model call, no paid scraping.
- Review of a new post: about $0.0025.
- Relearn: rulebook from up to 16 images, about $0.13, plus the logo-spot reread for lifecycle-owned settings (Opus 5.5, 6 images), about $0.05. About $0.18 in all.
- Per client per month: $0 with no new designed posts, at most about $0.80 (one relearn a week) plus reviews. Today: about $0.18 every 90 days, about $0.06 a month.
- Voice: one Opus 5.5 build a month as today (about $0.15), plus at most one early build when a platform qualifies. A look change adds one `brand_read`, the same cost as its 180-day reread.

### Tests

- corpus.test.ts: organic only; Stories, text and video out; one frame per post; ordered by date, never impressions; 6 per platform and 16 overall in turn; kept first; left out never back; age never shrinks below 3.
- Minimums: 3 posts on a platform borrows; 2 in all waits and keeps the old set; no rulebook section below 4.
- steps.test.ts: a week with no new posts makes zero model calls; a reviewed post is never reviewed again; two new posts relearn; a choice makes the step due; an account change still does; `synthesized_at` moves only on a relearn; a look change drops older posts and makes `brand_read` due.
- designSettings.test.ts: a person-owned row gets the new library and keeps its logo, placement and background.
- design-request week.test.ts: images labeled with platform and date, the request platform first.
- voice.test.ts: boosted out; under 5 no platform voice; a thin platform gets the overall voice, labeled; platform preferences filtered.
- UI tests (automaticBrandReferencesUi, designSettingsCard): per-platform lines, no button, Keep and Leave out save quietly, no developer words, American English.

### Files

- Create: supabase/migrations/[timestamp]_design_refs_refresh.sql (`design_reference_reviews`, `design_reference_choices` and its save function, `lifecycle_write_design_library`, `brand_voice_learnings.platform`, conversion of existing saves); supabase/functions/_shared/brand-references/corpus.ts and corpus.test.ts.
- Change: _shared/lifecycle/steps.ts, steps.test.ts, designSettings.ts; _shared/brand-references/discover.ts, candidates.ts, learnStyle.ts; _shared/design-prompts/designRefs.ts and its callers (resolveBrand.ts, loadCreativePlan.ts, plan-social-creative, build-design-system, build-social-templates, preview-brand-design, validate-design-output); design-request/index.ts; _shared/canva/options.ts; _shared/voice/voice.ts, load.ts, voice.test.ts; _shared/calendar/runWeek.ts; src/components/onboarding/AutomaticBrandReferences.tsx, DesignSettingsCard.tsx; src/integrations/supabase/types.ts; the two UI tests.
- Unchanged: video references, the RivalIQ thumbnail harvest for clients without Sprout (refreshFeed.ts), the brand book.

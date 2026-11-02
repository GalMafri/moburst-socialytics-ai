# Content strategy tab

Status: design, 2 Nov 2026. Lital approved building it on 2 Nov. Nothing is built yet.

## Why

On 23 Sep 2026 Neria and Sinéad asked Socialytics to write a client's content strategy, including for brand-new clients with no platforms yet: "sometimes I spend hours, even days on strategy", and "click a toggle that says brand new platforms or like already set up, reference what's there". Lital: "I'll create this in a different tab in the app and not in the onboarding."

The strategy writes itself from what the client lifecycle already knows. People may edit any section, and a person's edit is never overwritten.

## Brand new or set up, decided from data

The team's toggle becomes a state worked out per platform, so one client can run Instagram and launch TikTok in the same strategy. (My call.)

- Posting now: the client published there in the last 90 days, read the way the calendar reads its own posts (Sprout, or RivalIQ's copy where Sprout has no account).
- New: a primary platform, or one with an active Sprout account, with no posts in 90 days. A quiet account counts as new, and its plan names the handle.
- Candidate: a platform the trend profile lists for the industry that the client neither posts on nor chose. The model marks each one New or Not now with a reason; at most two candidates become New.

A brand-new client with no accounts gets its whole platform list from the trend profile, which already names where the industry's audience is active. A platform moves to Posting now at the first write after its first posts.

## What the strategy contains

1. Goals: two to four for the next 90 days, each with its reason. Goals from a strategy document (already in the brief) win.
2. Audience: who the client speaks to and what they want, built on the trend profile's audience.
3. Positioning: what sets the client apart from its tracked competitors, and how that shows in posts.
4. Pillars: one section per pillar, using the names from Client setup unchanged, so the calendar, the reports and the strategy share one list. Each gives the formats that worked (the client's or competitors'), its share of posts and two example post ideas. (My call.)
5. Platforms: one section per platform. Posting now: its role, what to post, what has worked. New: why this platform, account basics, the first 30 days with example posts, and what to check 30 and 90 days after the first post. Not now: one line each.
6. What to avoid: from the client's weakest posts, the trend profile's exclusions, and restrictions in the brief and brand notes.
7. How success is measured: a measure per platform and the direction that counts as success.

Code computes every number and the model writes the words around them. Cadence is the calendar's own resolved rhythm (`resolveRhythm`), so the two always agree; a New platform's cadence is its tracked competitors' median, else every tracked company's, the same fallbacks. Baselines are the last 90 days' posts per week, median engagement per post and engagement rate per impression. Targets are stated against those baselines, with no invented figures. (My call.)

Written in English for the team; example posts are in the client's first content language. (My call.)

## Where it comes from

Only what the lifecycle already reads: the brief (with any strategy document's words), pillars, keywords, brand notes, brand book, learned voice (`voicePromptBlock`), website text, competitors and `competitiveBrief`, the trend profile, Sprout accounts, primary platforms and the posting rhythm setting. Post evidence comes from the calendar's `gatherEvidence`, so the strategy and the calendar read the same numbers.

## When it is written

A new lifecycle step, `content_strategy`, after `trend_hashtags`. It runs in the app's lifecycle queue; nothing in n8n.

- inputs: null until `trend_profile` is done and current (its inputs key now equals its stored one), so a brand change gives one profile write, then one strategy write. The key is the profile's `written_at`, the client's active Sprout networks and a hash of `posting_rhythm`. The profile's key already covers the brief, pillars, keywords, notes, brand book, voice, site, market, language, primary platforms and competitors.
- policy: `refreshDays: 30`, so performance follows a month of data. (My call.)
- A person's edit is not an input and never sets off a write. (My call.)
- A failure retries quietly with the lifecycle's backoff, and the last good strategy stays on screen. `first_output` does not wait for this step. There is no Refresh button. (My call.)
- `posting_rhythm` joins the `clients_lifecycle` trigger, so a change is looked at at once.

## Editing, and how edits survive

Two tables. `content_strategies` (one row per client) holds the product's latest version of every section, the platform states with their code numbers, the inputs key, the written date, the models and the tokens. `content_strategy_edits` (client, section key, text, editor, editor's display name, edited at) holds people's versions. The lifecycle writes only the first. People write only the second, through `strategy_section_save` (staff with `can_access_client`). The page shows a person's version wherever one exists.

- Saving empty text hands the section back, as emptying a field does today. "Use the product's version" does the same.
- On every write the model gets people's versions as fixed context and keeps the other sections consistent with them.
- Section keys: `goals`, `audience`, `positioning`, `pillar:<name>`, `platform:<platform>:<state>`, `not_now`, `avoid`, `measures`. The state in a platform's key means an edited launch plan stops showing once the platform is posting. An edit whose pillar or platform leaves the strategy is kept, hidden, and shows again if it returns. (My call.)

## Who sees it

Staff who can access the client (`can_access_client`), so company-scoped staff see only their companies. Client users do not see it in this version. (My call.) The team asked for it as their own working draft; it names the client's weakest posts and reads competitors' tactics; clients already see its result in the calendar and analytics. The text carries no internal wording, so opening it to clients later is a change to one access rule and one route.

## The calendar planner

One addition. `strategyPromptBlock(db, clientId)` returns goals, audience, positioning, pillars, the Posting now platforms and what to avoid (people's versions where edited), at most 4,000 characters, or "" when there is no strategy. `weekPrompt` and `revisePrompt` place it after the pillars with one line: the rhythm, dates and evidence rules win wherever they differ. Rhythm, platforms, evidence, parsing and rules stay as they are, and a client without a strategy gets today's prompt byte for byte. New platforms are not planned, since posts need a live account; once posts appear, the calendar picks the platform up through its own rhythm.

## The tab

A Strategy item in the sidebar for staff, after Reports. `/strategy` lists active clients the way Analytics does, and `/clients/:id/strategy` is the page, behind `StaffOnlyRoute`. Client setup's "Content strategy" tab, which holds the inputs, is renamed "Strategy sources" and links to the page. (My call.)

The page is an `AppLayout` with the client's name, "Back to client", a client switcher, the written date in meta and a `SectionNav` rail. Goals, Audience, Positioning and What to avoid are split `Section`s: title and origin line on the left ("Written on 2 Nov from the brief, the website and 90 days of posts", or "Edited by Neria on 3 Nov. Kept when the strategy is rewritten."), the text in `Prose` on the right, Edit in the action slot. Edit swaps in a `Textarea` with Save and Cancel; Save goes through `sendQuietly`. Pillars and Platforms are band `Section`s with two-column card grids (one column below lg); a platform card shows its badge, state, code cadence line and text, with Not now as a short list below. Measures is a table of code baselines beside the model's text. Before the first write an `EmptyState` states the fact ("Written once the client's brief and trend profile are ready"); a failed read uses `LoadRetry`. No toasts, no failure copy.

## Cost

Per write: one Opus 5.5 call (`claude-opus-5-5`) writes the strategy, and one Sonnet 5.5 call (`claude-sonnet-5-5`) lists any number, name, result or claim not found in the evidence. A reply that fails the code checks (every section present, pillar sections matching the client's pillars exactly, each platform with the section its state needs, at most two candidates marked New, no evidence ids such as P1, no em dashes) is asked again once with its problems named (`askTwice`). Flagged statements get one fix call and one more check. At most three Opus and two Sonnet calls, usually one of each; if it still fails, the step retries later and the stored version stays. Evidence is capped (brief 6,000 characters, site and brand book 2,500 each, the planner's evidence lists) and output at 8,000 tokens. Writes: the first, then on brand or account changes and monthly. Edits cost nothing. Tokens are stored per write and the real cost is measured on the first clients, as with the calendar.

## Tests

- `strategy/platforms.test.ts`: each state from its data, a client with nothing getting the profile's list, cadence fallbacks.
- `strategy/write.test.ts`: each code check rejects; one re-ask; one fact fix; a still-flagged answer keeps the stored version; call counts and model ids.
- `lifecycle/steps.test.ts`: waits for a done, current trend profile; the key moves with the profile date, Sprout networks and posting rhythm, never with edits; a write never touches `content_strategy_edits`.
- `strategy/prompt.test.ts`: people's versions win; New platforms and measures left out; the cap holds; "" with no strategy.
- `calendar/weekPlan.test.ts`: with strategy "", both prompts equal today's output for a fixture; with one, the block appears once, after the pillars.
- `src/test/clientStrategy.test.tsx`: a person's version and its origin; Save through `sendQuietly`; saving empty hands back; no route or sidebar item for client users. The display guard covers the new screens on its own.

## Files

Create:
- `supabase/migrations/<timestamp after 20261108110000>_content_strategy.sql`: both tables, their RLS, `strategy_section_save`, `posting_rhythm` in the `clients_lifecycle` trigger
- `supabase/functions/_shared/strategy/platforms.ts`, `write.ts`, `prompt.ts`, each with its test
- `src/pages/StrategyIndex.tsx`, `src/pages/ClientStrategy.tsx`
- `src/components/strategy/StrategySection.tsx`, `src/components/strategy/StrategyPlatforms.tsx`
- `src/test/clientStrategy.test.tsx`

Change:
- `supabase/functions/_shared/lifecycle/steps.ts` and its test: the step, `posting_rhythm` in `CLIENT_COLUMNS`, the strategy's deps
- `supabase/functions/_shared/calendar/weekPlan.ts` and its test, `runWeek.ts`: the strategy block
- `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, `src/pages/ClientSetup.tsx`, `src/integrations/supabase/types.ts`

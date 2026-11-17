# Plan: calendar copy that mixes brands (three sources and the repair)

Repo: `/Users/user/Documents/AI Workflows/Dashboard/socialytics-instructions-back` (tree equals live main 7cfdfc7d). Paths below are under `supabase/functions/` unless they start with `supabase/migrations/`, `supabase/tests/` or `src/`. Tests run with `npm test` (vitest); test files live in `supabase/tests/` and import with `../../../functions/...`.

## 0. Ground rules for the builder

- General across clients. No client name in code, prompts or tests. Tests use invented brands (for example "Northwind Law", "Harbor Wax", "Harbor Wax (Lakeside)", "Dana Reed ★★★★★").
- No flags, no manual steps, nothing run from a laptop. Every repair runs inside the app's own jobs.
- Nothing may fail visibly on a screen. Every new read that can fail falls back to "no change" and logs with `console.warn`.
- Do not touch: `_shared/brand-references/*`, the `design_refs` lifecycle step, `_shared/canva/*`, `design-worker/`, `_shared/design/`, `_shared/competitive/landscapeCheck.ts`, `_shared/pipelines/`, `run-report/`, `run-scheduled-jobs/dispatch.ts`, `run-scheduled-jobs/trends.ts`, `_shared/trends/sources.ts`. Reading `trend_posts.lesson`, `trend_themes.angle` and `trend_themes.why_it_matters` is allowed; how trends are collected does not change.
- Four stages, one commit each, pushed together and deployed once (section 7).

Final decisions applied here:
1. The second account on a network is parked under the client (`is_active = false`, reason recorded). The app stops reading from it and publishing to it.
2. Re-plan every untouched upcoming post that cites an outside post, every untouched upcoming post of a client whose account set was changed by the rule, and every untouched upcoming post with time codes. Decorated names are corrected in place in every upcoming post, including posts people worked on.
3. The time-code rule applies whatever the evidence kind.
4. Trends stay. They tell the planner which subject is timely, never wording, facts, people or production details.
5. A feed company is the client only on exact name equality.

---

## 1. Today's behavior (file:line)

### Source 1: outside posts
- Trend evidence is read in `_shared/calendar/evidence.ts:704-747` (`latestTrendEvidence`): `trend_weeks`, then `trend_themes` (`id, title, post_ids`, line 712), then `trend_posts` (line 718, without `lesson`).
- `scoreTrendItems` (`evidence.ts:759-781`) builds each N item with `text: excerpt(t.text)` (220 characters, `evidence.ts:135-138`) and `company: t.author` (line 775).
- Competitor items: `numberEvidence` (`evidence.ts:799-802`) with `text: excerpt(s.post.text)` and `company`. Topics: line 806, our own "topic: summary", 260 characters.
- Prompt line: `_shared/calendar/weekPlan.ts:89-95` (`evidenceLine`) prints `ID [company platform format, date, theme "…", numbers] <excerpt>`. Section titles at `weekPlan.ts:116-121`.
- Rules: `weekPlan.ts:129` (the only line on borrowed material), `:133` (test post), `:137` (facts allowed when "in the evidence", which includes outside posts). The revise prompt has its own fact line at `:346` and prints evidence at `:348`.
- Reasons: `cited()` `weekPlan.ts:186-191`, `typeFor` `:171-177`, `buildReason` `:154-168`, `toRef` `:179` (copies the whole item into the stored reason). Words: `_shared/calendar/reasonText.ts:112-117`.
- Seasonal refusal, the pattern to follow: `weekPlan.ts:226-231` drops the post and pushes to `opts.dropped`; `runWeek.ts:598-599` stores `evidence.dropped_seasonal`.
- Planner call loop: `runWeek.ts:583-597`. Revision: `runWeek.ts:664-775`; it passes the reason words, which name the outside author, at `:715-716`.
- Unused, already in our own words: `trend_posts.lesson`, `trend_posts.why` (`_shared/trends/filter.ts:40`), `trend_themes.why_it_matters`, `trend_themes.angle` (`_shared/trends/themes.ts:25`).

### Source 2: two brands under one client
- `_shared/sprout/brands.ts:178-190` (`groupBrands`): one brand per Sprout group. `brands.ts:78` (`TAGLINE`) cuts at " (". `run-scheduled-jobs/sproutOnboarding.ts:322-326` passes every profile of the brand to `sprout_onboard_client`.
- Lifecycle `accounts` step: `_shared/lifecycle/steps.ts:1300-1367`. It only adds (`matchProfiles`, `_shared/lifecycle/accounts.ts:104-118`). Inputs key at `steps.ts:1309`.
- Readers of every active row: `_shared/competitive/ownedSource.ts:174`, `_shared/reports/payloads.ts:168` and `:266`, `steps.ts:278-285` (`activeProfiles`), `schedule-sprout-post/index.ts:48`.
- No code writes `is_active = false` today. The removal trigger acts only for a signed-in person (`supabase/migrations/20261019220000_lifecycle_steps.sql:175-189`), and a trigger on `sprout_profiles` queues a lifecycle look on every change (`supabase/migrations/20261019180000_client_lifecycle.sql:83-84`).
- `client_public_profiles` holds one profile per platform (`_shared/strategy/profiles.ts:29-52`).
- `social_read` is keyed on profile ids (`steps.ts:1378`); its version moves by `versionMove` (`_shared/lifecycle/socialRead.ts:306-323`, called at `:706`).
- Latent: `evidence.ts:442-446` (`isClientPost`) counts a feed company whose name contains the client's name as the client. Callers: `runWeek.ts:153`, `runWeek.ts:251`, `_shared/calendar/runMoments.ts:263`, `_shared/strategy/publicRead.ts:218`.

### Source 3: display names
- Own-post text is taken as is: `ownedSource.ts:114` (`row.text`), `_shared/pipelines/linkedin/sources.ts:175` (`row.content`); mapped to `OwnPost.text` in `runWeek.ts:139-143` and `:158`.
- No structured mention data is requested or stored (`ownedSource.ts:231`, `_shared/sprout/posts.ts:37`). A mention arrives inline as the display name, with no "@".
- Voice builder: sample `_shared/voice/voice.ts:85-93`, prompt `:204-234` (700 characters per post at `:207`), parse `:245-270` (phrases stored unfiltered), planner block `:160`. Build and store: `_shared/voice/load.ts:212-242`. Job: `runWeek.ts:796-810`.
- Sprout's profile list (`_shared/sprout/profiles.ts:57-79`) holds the exact display names, including personal LinkedIn profiles. The `accounts` step downloads it on every run (`steps.ts:1313`).

### Re-plan machinery that exists
- `calendar_request_revision(p_plan, p_note, p_user, p_scope)`: `supabase/migrations/20261019140000_weekly_calendar.sql:180-216`, scopes `untouched` and `empty` (check at line 186).
- System rewrites with no person: `_shared/notes/run.ts:231-254` (`askForRewrites`).
- What a revision keeps: `workedOn` (`runWeek.ts:641-648`, SQL `calendar_post_worked` in `supabase/migrations/20261113100730_calendar_post_worked_sent_only.sql`), `revisedByPerson` (`runWeek.ts:655-662`, applied at `:703`), the guarded update at `:743`, Stories following at `:751`.
- Version pattern: a rule constant in a step's inputs key (`steps.ts:1736`, `|pick:${LOGO_PICK_RULE}`), policy in `_shared/lifecycle/policy.ts:54-65`.

---

## 2. Stage 1: display names are plain (commit 1)

**Rule.** A display name the agency's Sprout account lists is written as its plain name wherever the app learns from text or writes copy. Plain means: cut at a tagline separator (" | ", " - ", " – ", " — "), symbols and emoji removed, parentheses kept.

### 2.1 New file `_shared/text/displayName.ts` (pure, no imports)
```ts
/** A tagline after a name: " | ", " - ", " – ", " — ". Parentheses are part of the name. */
export const NAME_TAGLINE = /\s+\|\s*|\s*\|\s+|\s+[-–—]\s+/;
/** Symbols and emoji a display name may carry. */
const DECORATION = /[\p{S}\p{Extended_Pictographic}️‍]/gu;
export const NAME_MIN_CHARS = 3;

export function plainDisplayName(name: string | null | undefined): string;
// String(name ?? "").split(NAME_TAGLINE)[0], DECORATION removed, spaces collapsed,
// trailing [\s,;:·•]+ trimmed.

export function decoratedNames(names: Array<string | null | undefined>): string[];
// distinct trimmed names whose plain form differs from them and has NAME_MIN_CHARS or more,
// longest first, at most 200.

export function plainNames(text: string, decorated: string[]): string;
// for each decorated name, longest first: text.split(name).join(plainDisplayName(name)).
// Exact, case-sensitive. Text with none of them is returned unchanged (same reference).
```

### 2.2 `accounts` step stores the names
`_shared/lifecycle/steps.ts`, in `accounts.run` result (`:1358-1365`): add `display_names: decoratedNames(profiles.map((p) => p.name))`. `profiles` is the whole account list read at `:1313`.

### 2.3 `runWeek.ts`
- New exported helper:
```ts
export async function accountsFacts(admin: Db, clientId: string): Promise<{ names: string[]; ownDroppedAt: string | null }>;
```
It reads `client_lifecycle_steps` (`step = 'accounts'`, column `result`) and returns `result.display_names` (strings only) and `result.own_dropped_at` (stage 2). Any error returns `{ names: [], ownDroppedAt: null }` with a `console.warn`.
- `ownPosts()` (`:127-162`): read `accountsFacts` once, apply `plainNames(text, names)` to `text` on both branches (`:141` and `:158`), and return `{ posts, sprout, stories, names }`. `ProfileIO.ownPosts` (`_shared/trends/profile.ts:36`) is structural, so the extra field compiles.
- `runVoiceProfile` (`:801-802`): pass `names` on: `buildVoiceProfile(admin, client.id, posts, now, { names })`.

### 2.4 `_shared/voice/voice.ts`
- `export const VOICE_RULE = 1;` (the version of what a voice profile is built from; used in stage 4).
- `SocialVoice` gains `rule?: number`.
- `platformVoice(p, names: string[] = [])`: every string field and every phrase goes through `plainNames(x, names)` before the length cut.
- `parseVoiceProfile(text, platforms, names: string[] = [])` and `parseOverallVoice(text, names: string[] = [])` pass `names` down.

### 2.5 `_shared/voice/load.ts`
`buildVoiceProfile(admin, clientId, posts, now = new Date(), opts: { names?: string[] } = {})`: pass `opts.names ?? []` to both parsers (`:221-222`) and store `rule: VOICE_RULE` on the profile (`:230-238`).

### 2.6 `weekPlan.ts`
- `parseWeekPlan(text, c, opts: { dropped?: DroppedPost[]; refused?: RefusedPost[]; check?: CopyCheck; names?: string[] } = {})`: `copy`, `cta` and `visual_direction` go through `plainNames(x, opts.names ?? [])` right after `str(...)`. (`refused` and `check` arrive in stage 3; add only `names` now.)
- `parseRevision(text, ids, evidence = [], withReasons = false, opts: { names?: string[]; check?: CopyCheck; refused?: RefusedPost[] } = {})`: same cleaning.
- `runWeekPlan` (`runWeek.ts:593`) and `runWeekRevise` (`:733`) pass `names` (from `accountsFacts`).

### 2.7 Tests (stage 1)
- New `supabase/tests/_shared/text/displayName.test.ts`: stars removed; " - Tagline" and " | tagline" cut; "(City)" kept; a plain name is not listed; longest first; text with no listed name is unchanged; a name of only symbols is not listed.
- `supabase/tests/_shared/voice/voice.test.ts`: a reply whose phrase and summary hold a listed decorated name is stored plain; no names means no change.
- `supabase/tests/_shared/voice/load.test.ts`: `buildVoiceProfile` stores `rule: VOICE_RULE` and plain phrases.
- `supabase/tests/_shared/calendar/runWeek.test.ts`: `ownPosts` returns plain text for both the Sprout branch and the feed branch when the accounts step row lists a name; a failed read of the step row leaves text as it was.
- `supabase/tests/_shared/calendar/weekPlan.test.ts`: `parseWeekPlan` and `parseRevision` write the plain name in copy and cta.
- `supabase/tests/_shared/lifecycle/steps.test.ts`: the accounts result lists decorated names from the whole Sprout list, including a personal LinkedIn profile.

Commit message: `Display names are plain wherever copy is learned or written`

---

## 3. Stage 2: one own account per network (commit 2)

**Rule.** A client has at most one own account per network. Which one is the brand's is decided from exact facts in a fixed order, the other is parked with the reason recorded, and nothing reads from or publishes to a parked account.

### 3.1 `_shared/lifecycle/accounts.ts`
```ts
import { ownedNetwork } from "../competitive/ownedMerge.ts";
import { plainDisplayName } from "../text/displayName.ts";

export const ONE_PER_NETWORK_RULE = 1;

export interface OwnRow { id: string; name: string; native_name: string; network_type: string; is_active: boolean }
export type OwnBy = "only" | "person" | "name" | "public_profile" | "handle" | "name_cut" | "oldest";
export interface OwnPick { network: string; kept: string; dropped: string[]; by: OwnBy; why: string }

export function ownPerNetwork(i: {
clientName: string;
/** Every sprout_profiles row of the client, active or not. */
rows: OwnRow[];
/** client_public_profiles rows of the client. */
publicProfiles: Array<{ platform: string; handle: string; source: string }>;
/** Ids this rule parked in the step's last result (result.own[].dropped). */
parkedBefore: string[];
}): { keep: string[]; park: string[]; picks: OwnPick[] };
```
- Network of a row: `ownedNetwork(row.network_type)` (so `fb_instagram_account` is instagram, `linkedin_company` and `linkedin` are both linkedin).
- Candidates on a network: rows that are active, plus inactive rows whose id is in `parkedBefore`. Inactive rows not in `parkedBefore` are ignored.
- One candidate: kept (`by: "only"`); if it was parked it is restored. No `OwnPick` is recorded for a network that never had two.
- More than one candidate: narrow in this order. At each step, if exactly one candidate qualifies it is kept; if several qualify the set narrows to them; if none qualify the set is unchanged.
1. `person`: active and in `parkedBefore` (a person switched it back on).
2. `name`: `sameName(row.name, clientName)` on the whole name (`_shared/lifecycle/names.ts:21`).
3. `public_profile`: the row's handle equals, case-insensitively and without "@", the `client_public_profiles` handle for that platform with `source !== "removed"`. Platform of a row: `NETWORK_PLATFORM` (`accounts.ts:32-35`); a personal LinkedIn profile has none.
4. `handle`: the row's handle, lowercased and reduced to letters and digits, equals that of the client's kept row on another network decided by `only` or steps 1 to 3. Run networks in two passes so step 4 sees those results.
5. `name_cut`: `sameName(plainDisplayName(row.name).split(/\s+\(/)[0], clientName)`.
6. `oldest`: smallest id (shorter id first, then lexicographic, as `byId` in `brands.ts:52`).
- `why` is one sentence, for example: `Kept "<name>" (<handle>) on <network>: its name is the client's name. Parked: "<name>" (<handle>).` One wording per `OwnBy`.

### 3.2 `accounts` step (`steps.ts:1300-1367`)
- Inputs (`:1302-1310`): read the client's active rows (`sprout_profiles`, `client_id`, `is_active = true`, column `network_type`), compute the networks with more than one, and return
`name:…|site:…|links:…|removed:…|own:${ONE_PER_NETWORK_RULE}` plus `|dup:<networks sorted, comma-joined>` only when there is one. A person adding a second account changes the key, so the step runs at once; after it parks one the key changes back, which costs one more cheap run. Say so in the comment above the step.
- Run:
- Extend the select at `:1326` with `profile_name, native_name`.
- After the matches are inserted (`:1337-1344`) and after `syncProfiles` (`:1354-1357`, move the pick below it), build `rows` for this client (existing rows plus the new matches as active), read `client_public_profiles` (`platform, handle, source`), take `parkedBefore` from `rows.get("accounts")?.result?.own` (flatten `dropped`), and call `ownPerNetwork`.
- Write only what changed: `update sprout_profiles set is_active = false` for `park` ids that are active; `set is_active = true` for `keep` ids that are inactive. Both with the service role, filtered by `client_id` and `sprout_profile_id`.
- `mine` (`:1345`) excludes parked ids, so `primary_platforms` follows.
- Result gains `own: picks` and `own_dropped_at`: now (ISO) when this run parked an account that was active, else the previous result's value, else null.
- Parked rows stay in the table, so `matchProfiles` (`accounts.ts:110`) and `sprout_onboard_client` never hand them to another client, and `matchBrand` (`brands.ts:276`) keeps reading them as this client's.

### 3.3 `_shared/sprout/brands.ts`
- `brandName(profiles, group = null, clean: (name: string) => string = profileBrandName)`: `clean` replaces the call at `:101`.
- `brandOf(profiles, group = null, opts: { key?: string; whole?: boolean } = {})`: `opts.key` overrides the key; `opts.whole` names with `plainDisplayName` (parentheses kept) so a split brand does not take its sibling's name.
- `groupBrands` (`:178-190`): for each group, when no network (`networkKey`, `_shared/sprout/publishRules.ts:46`) has more than one live profile, `brandOf(ps, group)` as today. Otherwise split with the existing `looseBrands` rule (`:156-175`: same normalized whole name, then a handle shared across networks), give every part the group, name each with `whole: true`, and key the part with the oldest profile `group:<id>` and the others `group:<id>:<smallest profile id>`.
- New `export function networkConflict(brand: Brand): string | null`: a sentence when one brand still holds two profiles on a network (same name twice), else null. Wording: `Left alone: it has two <network> profiles named alike (<names>), so which one is the brand's is unclear.`
- `run-scheduled-jobs/sproutOnboarding.ts:214`: `const conflict = r || decline ? null : groupConflict(brand, groups) ?? networkConflict(brand);` The decision stays `group_conflict`. Nothing else changes there: a brand now has one profile per network by construction.

### 3.4 `_shared/lifecycle/socialRead.ts`
- `versionMove(prev, cur, posts, now, ownDroppedAt: string | null = null)`: after the `!prev` line add
`if (ownDroppedAt && Date.parse(ownDroppedAt) > Date.parse(prev.at)) return "profiles";`
- At `:706` pass `rows.get("accounts")?.result?.own_dropped_at` (the step receives `rows`). The version then moves, `brief_pillars` reruns through `socialVersionKey` (`:858-861`) and rewrites pillars the lifecycle owns. Pillars a person set are untouched, as today.

### 3.5 `evidence.ts:442-446` (decision 7)
```ts
import { sameName } from "../lifecycle/names.ts";
export function isClientPost(p: any, clientCompany: string | null, clientName: string): boolean {
if (clientCompany && String(p?.companyId) === clientCompany) return true;
return sameName(p?.companyName, clientName);
}
```
`names.ts` has no imports, so `evidence.ts` stays free of Deno and network imports.

### 3.6 What follows by itself for a client that had two
`accounts` parks, the `sprout_profiles` trigger queues a look, `social_read` reruns (its key holds the ids) and moves its version, `brief_pillars`, `trend_profile` and `content_strategy` rerun on their own keys, and `design_refs` reruns on its fingerprint (owned by a sibling builder; nothing to do here). The voice and the calendar follow in stage 4.

### 3.7 Tests (stage 2)
- `supabase/tests/_shared/lifecycle/accounts.test.ts`: each step of the order decides alone; narrowing when two qualify; `oldest` as the last word; a personal and a company LinkedIn profile count as one network and the company page named like the client is kept; a parked account returns when the kept row is gone; a parked account a person switched on wins; a network with one account records no pick.
- `supabase/tests/_shared/lifecycle/steps.test.ts`: the step parks and writes `own` and `own_dropped_at`; the key ends in `|own:1` and carries `|dup:` only with a duplicate; `primary_platforms` ignores parked rows; no row is written to `sprout_profile_removals`; a second run changes nothing and keeps `own_dropped_at`.
- `supabase/tests/_shared/sprout/brands.test.ts`: a group with two per network becomes two brands with different names and keys; a group whose networks differ and whose names differ stays one brand; two profiles with the same name on one network give `networkConflict`.
- `supabase/tests/run-scheduled-jobs/` onboarding test: a split brand whose profiles are assigned (active or parked) is "matched"; creation receives one profile per network; a conflict is left alone.
- socialRead test: `own_dropped_at` after the snapshot moves the version with "profiles"; before it, or absent, does not.
- `supabase/tests/_shared/calendar/evidence.test.ts`: `isClientPost` is true on the company id, true on the exact name (case, punctuation and a trailing LLC ignored), false when the company name only contains the client's name.

Commit message: `One own account per network, decided by exact facts`

---

## 4. Stage 3: outside posts give the subject only (commit 3)

**Rule.** An outside post (competitor post C, competitor topic T, trend N) tells the planner which subject is timely. Its wording, facts, figures, people and production details never enter the client's copy, and no planned post carries time codes.

### 4.1 `evidence.ts`
- `EvidenceItem` gains optional planner-only fields: `lesson?: string` (trend post), `matters?: string` and `angle?: string` (its theme), `subject?: string` (competitor post). `text` and `company` stay: the stored reason, the reason's words and the content strategy read them.
- `TrendEvidenceInput` gains `lesson: string; matters: string; angle: string`.
- `latestTrendEvidence`: themes select becomes `id, title, post_ids, why_it_matters, angle` (`:712`); posts select adds `lesson` (`:718`); `out.push` adds `lesson: String(p.lesson ?? "")`, `matters: String(t.why_it_matters ?? "")`, `angle: String(t.angle ?? "")`.
- `scoreTrendItems`: the item carries `lesson`, `matters`, `angle` (each only when non-empty).
- `numberEvidence`: a competitor item gets `subject` = the `topic` of the first entry of `input.topics` whose `post_urls` include the post's link.
- New:
```ts
export interface OutsideSource { id: string; kind: "trend" | "competitor"; author: string; text: string }
/** The full captions of the outside posts in the evidence, for the copy check only. Never stored, never in a prompt. */
export function outsideSources(evidence: EvidenceItem[], trends: TrendEvidenceInput[], competitors: Array<{ post: CompetitorPost }>): OutsideSource[];
// trend: the input whose link equals the item's link; competitor: competitors[n - 1] for id "C<n>".
```

### 4.2 `runWeek.ts` `gatherEvidence` (`:238-311`)
`Gathered` gains `outside: OutsideSource[]`, built from the unscored trend inputs (keep the `latestTrendEvidence` result in a variable at `:282`) and `competitors`. It is not added to the plan's stored `evidence` (`:547`) and not returned by `preview_evidence` (`calendar-posts/index.ts:145`).

### 4.3 New file `_shared/calendar/copyChecks.ts` (pure)
```ts
import type { EvidenceItem, OutsideSource } from "./evidence.ts";

/** The version of the copy rules a plan was written under (calendar_plans.evidence.rules). */
export const COPY_RULE = 1;
/** A run of this many consecutive words shared with one outside caption refuses the post. */
export const SHARED_RUN_WORDS = 6;
/** This many distinct word trigrams shared with one outside caption refuses the post. */
export const SHARED_TRIGRAMS = 5;
/** An author name shorter than this is not searched for. */
export const AUTHOR_MIN_CHARS = 5;
/** More time codes than this refuse the post; "0:00" refuses it alone. */
export const TIME_CODES_MAX = 2;
/** Endings a bare domain is recognized by. */
export const LINK_TLDS = ["com","net","org","io","ai","co","app","me","ly","gg","tv","us","uk","ca","de","il","link","bio","shop","store","info","biz","dev","xyz"];

export interface OwnFacts {
/** The client's website host, lowercase, without www. */
hosts: string[];
/** The client's own handles, lowercase, without "@". */
handles: string[];
/** The client's own posts of the last 90 days and its notes, lowercase, joined. */
text: string;
/** The client has notes in use. */
hasNotes: boolean;
}
export interface CopyCheck { outside: OutsideSource[]; own: OwnFacts }
export interface RefusedPost { id?: string; date: string; platform: string; copy: string; why: string; ids: string[] }

export function copyWords(text: string): string[];
// lowercase; links (https?://\S+, www.\S+), @handles and #hashtags removed; apostrophes removed;
// every other non letter or digit becomes a space; split on spaces.
export function sharedWording(copy: string, source: string): { run: number; trigrams: number };
// run: longest common run of consecutive words; trigrams: distinct word trigrams in both.
export function borrowedFrom(copy: string, outside: OutsideSource[]): { id: string; why: string } | null;
// first source with run >= SHARED_RUN_WORDS or trigrams >= SHARED_TRIGRAMS ("shares wording with N5"),
// or whose author (copyWords joined, AUTHOR_MIN_CHARS or more) appears as whole words ("names who posted N5").
export function timeCodes(text: string): { count: number; zero: boolean };
// matches of /(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?![\d:])/g; zero: one of them is 0:00, 00:00 or 0:00:00.
export function foreignLinks(text: string, own: OwnFacts): string[];
// hosts of links with a scheme or www, and bare domains ending in LINK_TLDS, that are neither an own host
// (or a subdomain of one) nor found in own.text.
export function foreignHandles(text: string, own: OwnFacts): string[];
// /(?<![\p{L}\p{N}._])@([A-Za-z0-9_.]{3,})/gu, lowercase, trailing dots cut; not in own.handles and "@handle" not in own.text.
export function refersToProblem(refersTo: unknown, evidence: EvidenceItem[], own: OwnFacts): string | null;
// null or absent: fine. An object with a "what": its evidence_id must be the id of an item of kind "own" or "report",
// or the word "notes" with own.hasNotes. Anything else: "points to something the client's evidence does not show".
export function checkCopy(i: { copy: string; cta?: string | null; refersTo?: unknown; evidence: EvidenceItem[]; check: CopyCheck }): { why: string; ids: string[] } | null;
// order: borrowedFrom (against every outside source of the week, cited or not), timeCodes
// (zero or count > TIME_CODES_MAX: "carries time codes"), foreignLinks, foreignHandles, refersToProblem.
// ids: the outside ids a borrowed refusal names, else [].
export function outsideFromReasons(reasons: unknown): OutsideSource[];
// the trend and competitor refs stored in reasons[0].evidence, with their stored excerpt and company.
export function citesOutside(reasons: unknown): boolean;
// reasons[0].evidence holds a ref of kind "trend", "competitor" or "topic".
```
Calibration on live data (63 upcoming posts citing a trend, against full captions): 4 share a 6-word run, 7 meet "run of 6 or 5 trigrams", 16 share 3 or more trigrams. The check is the backstop; removing captions from the prompt is what stops retelling.

### 4.4 `weekPlan.ts`: what the planner receives
- `toRef` (`:179`) picks the stored fields explicitly (`id, kind, text, platform, company, format, date, link, metric, value, median, multiple, sample, thin, companies, theme, key, category, fit`), so the new fields never land in `reasons`.
- `evidenceLine` (`:89-95`):
- trend: `` `${e.id} [${[[e.platform, e.format].filter(Boolean).join(" "), e.date, e.thin ? "early signal" : ""].filter(Boolean).join(", ")}] Lesson: ${e.lesson || "not summarized"}` ``
- competitor: `` `${e.id} [${[[e.platform, e.format].filter(Boolean).join(" "), e.date, numbers, e.thin ? "early signal" : ""].filter(Boolean).join(", ")}] Subject: ${e.subject || "not summarized"}` ``
- own, topic, report, moment: unchanged.
- New `trendLines(brand: string, items: EvidenceItem[]): string[]`: themes in the order they first appear; for each, one line `Theme "<theme>". Why it matters: <matters> Angle for <brand>: <angle>` (a missing part is left out), then its N lines. Items without a theme follow as plain N lines.
- Section titles, word for word:
- `:117` becomes `"Competitor posts that beat that competitor's usual numbers this week, by format and subject (their captions are left out on purpose):"`
- `:119` becomes `"Industry trends this week: subjects other companies are covering now, described in our words (their captions are left out on purpose):"` followed by `trendLines(c.brand, byKind("trend"))`.
- Rules, exported so both prompts use the same words:
```ts
export const outsideRule = (brand: string) =>
`- C, T and N evidence is what other companies posted. It says which subject is timely and nothing more. Write the post from ${brand}'s own material: its P and R evidence, pillars, notes and voice. Never take an outside post's wording, facts, figures, people, examples or production details (chapters, series names, who appears), and never name who posted it. Use an outside subject only when it fits the client's pillars, audience and services, and say how in fit.`;
export const factsRule = (brand: string) =>
`- Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in ${brand}'s own evidence (P, R and M), the pillars or the voice section.`;
export const assetRule = (brand: string) =>
`- Tell the reader to watch, read, download or attend only something that ${brand}'s own posts (P), its report (R) or its notes show exists. Then refers_to is {"what":"video|guide|page|event|offer","evidence_id":"P1"}, with the P or R id that shows it or "notes". When the post points to nothing that already exists, refers_to is null. Never write time codes or chapter times: a planned video has none yet.`;
```
- `:129` becomes `"- Every post acts on the evidence above: list the ids in evidence_ids."` followed by `outsideRule(c.brand)`.
- `:137` becomes `factsRule(c.brand)`, followed by `assetRule(c.brand)`.
- Reply shape (`:140`): add `"refers_to":null` between `"fit":"..."` and `"test":false`.
- `revisePrompt` (`:322-352`):
- scope type: `"untouched" | "empty" | "replan"`.
- `writing` for `replan`: `"Write each of these posts again from the evidence. Keep its date, platform and format. Pick evidence for each and cite its ids. Its earlier copy is left out on purpose."`
- `:346` becomes: for `untouched`, `` `- Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in the posts as they stand, ${c.brand}'s own evidence (P, R and M), the pillars or the voice section.` ``; for the other scopes `factsRule(c.brand)`. Then `outsideRule(c.brand)` and `assetRule(c.brand)` for every scope.
- Evidence (`:348`): non-trend items through `evidenceLine`, then `trendLines`.
- Reply shape (`:350`): the reason fields and `"refers_to":null` when `c.scope !== "untouched"`; `"refers_to":null` alone for `untouched`.
- New `reasonForPlanner(r: Reason): string` used at `runWeek.ts:715`: for a first ref of kind trend `Trend theme "<theme>"`; competitor `A competitor's <platform> <format>`; otherwise `wordReason(r)`. No author, no company.

### 4.5 `weekPlan.ts`: the check at parse time
- `parseWeekPlan`: after the seasonal drop (`:228-231`) and before the cap accounting (`:232-237`), when `opts.check` is given run `checkCopy({ copy, cta, refersTo: p.refers_to, evidence: c.evidence, check: opts.check })`. A refusal pushes `{ date, platform, copy: firstLine(copy), why, ids }` to `opts.refused` and skips the post, so it uses no slot.
- `parseRevision`: the same per post, with `id`; a refused post is left out of the result and pushed to `opts.refused`.

### 4.6 `runWeek.ts`: plan and revise
- Build once per run:
```ts
function ownFacts(client, gathered: Gathered, voice: ClientVoice, profiles: { handles: string[] }): OwnFacts
```
`hosts` from `client.website_url`; `handles` from the client's active `sprout_profiles.native_name` and `client_public_profiles.handle` (one small read each, a failed read gives `[]`); `text` from `gathered.own` texts plus `notesSectionLines(voice.notes)` (`_shared/notes/notes.ts:300`), lowercased; `hasNotes` when those lines are not empty.
- `runWeekPlan` loop (`:583-599`), still at most two model calls:
1. Call, `parseWeekPlan(result.text, ctx, { dropped, refused, check, names })`.
2. No posts and a call left: call again as today.
3. Posts and refusals and a call left: one more call with `existing` extended by the kept posts (`{ date, platform, copy }`) and `evidence` without the outside ids the refusals named. Parse the same way and add what it returns. Posts refused again are dropped.
4. Store `evidence.rules = COPY_RULE` always, and `evidence.dropped_copy = [...]` (the refusals that were not replaced, each `{ date, platform, copy, why }`) when there are any, next to `dropped_seasonal` (`:599`).
- `runWeekRevise` (`:664-775`):
- `pending.scope` type adds `"replan"`. `gathered` is read when `scope !== "untouched"` (`:713`).
- `check`: for `empty` and `replan`, `{ outside: gathered.outside, own }`; for `untouched`, `outside` is the union of `outsideFromReasons(p.reasons)` over the targets.
- `revisePosts` for `replan`: `copy: ""` and `reason: ""`; for `untouched` the reason is `reasonForPlanner`.
- `parseRevision(result.text, ids, reviseEvidence, pending.scope !== "untouched", { names, check, refused })`.
- "No usable posts" is thrown only when the reply held no post at all. When every post was refused the revision finishes.
- For `empty` and `replan`, posts refused get one more call for those ids only (same prompt, evidence without the named outside ids). A post refused twice keeps the copy it had.
- The revision entry (`finish`, `:676-679`) gains `refused: [{ id, why }]` when there are any.

### 4.7 Tests (stage 3)
- New `supabase/tests/_shared/calendar/copyChecks.test.ts`: the real pattern rebuilt with invented names (an outside explainer retold with a 6-word run is refused; the same subject in new words passes); 5 trigrams without a 6-word run is refused; hashtags, handles and links do not count as shared words; an author name in the copy is refused, a 4-letter author is not searched; "0:00" refuses alone; three clock times refuse, two do not; a link to the client's site or one seen in its own posts passes, another host is refused; an own handle passes, an outside handle is refused, an email address is not a handle; `refers_to` with a P id passes, with an N id or an unknown id is refused, "notes" passes only with notes; `outsideFromReasons` and `citesOutside` on stored reasons.
- `weekPlan.test.ts`: the trend section shows the theme, why it matters, the angle and the lesson, and holds neither the caption nor the author; the competitor line holds neither caption nor company; the three rule lines are present word for word in both prompts; the reply shape holds `refers_to`; `toRef` stores no `lesson`, `angle`, `matters` or `subject`; a refused post takes no slot and is listed in `refused`; `revisePrompt` for `replan` shows no current copy and no reason; `reasonForPlanner` names no author.
- `evidence.test.ts`: `latestTrendEvidence` returns lesson, matters and angle; `scoreTrendItems` and `numberEvidence` carry them; `subject` comes from the topic that lists the post's link; `outsideSources` returns full captions by id.
- `runWeek.test.ts`: a first reply with one refused post triggers one more call whose prompt lists the kept posts as already on the calendar and no longer lists the named outside id; a second refusal lands in `evidence.dropped_copy`; `evidence.rules` is stamped; never more than two calls; a revision whose posts are all refused finishes and records `refused`.
- Update the existing assertions that quote the old title at `:119` and the old rule at `:129`.

Commit message: `Outside posts give the subject only: evidence, rules and checks`

---

## 5. Stage 4: voices rebuilt and upcoming posts re-planned by the app (commit 4)

### 5.1 Migration `supabase/migrations/20261118110000_calendar_replan.sql`
Additive, safe to run twice, same signature and grants. Header comment in the house style (what and why). Body: restate `calendar_request_revision` exactly as in `20261019140000_weekly_calendar.sql:180-216` with one change:
```sql
create or replace function public.calendar_request_revision(p_plan uuid, p_note text, p_user uuid default null, p_scope text default 'untouched')
returns public.calendar_plans
language plpgsql security definer set search_path = public as $$
declare
v_plan calendar_plans;
begin
if p_scope not in ('untouched', 'empty', 'replan') then
  raise exception 'Unknown revision scope %', p_scope;
end if;
-- the rest unchanged: the note check, the update of pending_revision on a ready plan with none waiting,
-- the three exceptions, the voice_profile job for a client with no voice, the week_revise job
end $$;

revoke all on function public.calendar_request_revision(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_request_revision(uuid, text, uuid, text) to service_role;
```
No new overload, no drop, no table change. The daily "empty" filler (`20261019190000_calendar_self_serve.sql:224-247`) and the notes rewrite keep working: both read `scope` by value.

### 5.2 New file `_shared/calendar/replan.ts` (pure)
```ts
import { COPY_RULE, citesOutside, timeCodes, TIME_CODES_MAX } from "./copyChecks.ts";

export const REPLAN_NOTE = "Write these posts again from the client's own material.";

export interface ReplanPlan { ready_at: string | null; evidence: { rules?: unknown } | null; revisions: unknown }
export interface ReplanPost { copy: string | null; reasons: unknown }
export type ReplanWhy = "accounts" | "outside" | "time_codes";

/** The rules version a plan was written or last re-planned under; 0 when it carries none. */
export function planRules(plan: ReplanPlan): number;
/** When the plan last followed the client's accounts: ready_at, or a later finished revision of scope "replan". */
export function followedAt(plan: ReplanPlan): number;
/** Why a post is written again, or null. */
export function replanWhy(post: ReplanPost, plan: ReplanPlan, facts: { ownDroppedAt: string | null }): ReplanWhy | null;
// "accounts": facts.ownDroppedAt is later than followedAt(plan).
// "outside": planRules(plan) < COPY_RULE and citesOutside(post.reasons).
// "time_codes": planRules(plan) < COPY_RULE and the copy has a zero time code or more than TIME_CODES_MAX.
```

### 5.3 `runWeek.ts`
- `runWeekRevise` targets (`:706`): for `replan`, `replanWhy(p, plan, { ownDroppedAt }) !== null`, with `ownDroppedAt` from `accountsFacts`. Stories are never targets and follow their post (`:751`), as today.
- `finish` for `replan` also writes `evidence: { ...(plan.evidence ?? {}), rules: COPY_RULE }`, so the plan is not asked again.
- `runVoiceProfile` (`:796-810`): after a successful build, `await admin.rpc("lifecycle_enqueue", { p_client: job.client_id, p_priority: 30, p_at: new Date().toISOString() })`, an error only warned. Call the rpc directly: importing `_shared/lifecycle/run.ts` here would be a circular import (`steps.ts:58` imports `runWeek.ts`).

### 5.4 Two lifecycle steps in `_shared/lifecycle/steps.ts`
Place `voice` after `social_read` and `calendar_recheck` after `first_output`. Update the header list (`steps.ts:11-25`).

```ts
// The client's voice profile built again when what it is built from changes: the rule's version
// (plain display names) or the client's own accounts. The first profile belongs to the first plan
// (calendar_request_week); the monthly rebuild stays there too.
voice: {
policy: {},
async inputs(db, client, rows) {
  if (!client.voice_built_at) return null;
  const acc = rows.get("accounts");
  if (!settled(rows, "accounts") || !str(acc?.inputs_key).includes(`|own:${ONE_PER_NETWORK_RULE}`)) return null;
  const ids = (await activeProfiles(db, client.id)).map((p) => p.id);
  return `rule:${VOICE_RULE}|profiles:${ids.join(",")}`;
},
async run(db, client) {
  const ids = (await activeProfiles(db, client.id)).map((p) => p.id);
  const key = `voice_profile:${client.id}:rule${VOICE_RULE}:${textHash(ids.join(","))}`;
  const at = deps.now().toISOString();
  const { error } = await db.from("scheduled_jobs").upsert(
    { kind: "voice_profile", client_id: client.id, dedupe_key: key, priority: 39, available_at: at },
    { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) return { status: "failed", error: `Could not queue the voice profile: ${error.message}` };
  return { status: "done", result: { queued: key, at } };
},
},
```
The key differs from the daily key (`runWeek.ts:629`), so a profile already built today does not block it. Plans and revisions already wait for a queued voice job (`runWeek.ts:346-351`).

```ts
// The upcoming calendar checked against the copy rules whenever they or the voice change:
// decorated names corrected in place, and one revision asked for each week that holds posts
// written from an outside post, with time codes, or before the client's accounts changed.
calendar_recheck: {
policy: {},
async inputs(db, client, rows) {
  if (!client.voice_built_at || !settled(rows, "voice")) return null;
  // A voice profile on its way: wait for it.
  const { count, error } = await db.from("scheduled_jobs").select("id", { count: "exact", head: true })
    .eq("client_id", client.id).eq("kind", "voice_profile").in("status", ["queued", "running"]);
  if (error) throw new Error(`Could not check the voice profile: ${error.message}`);
  if (count) return null;
  return `rules:${COPY_RULE}|voice:${client.voice_built_at}|own:${str(rows.get("accounts")?.result?.own_dropped_at)}`;
},
async run(db, client, { rows }) { /* below */ },
},
```
`run`:
1. `today = weeksFor(client.timezone, deps.now()).today`; `names` and `ownDroppedAt` from the accounts row in `rows`.
2. Read ready plans with days to come: `calendar_plans` (`id, week_start, ready_at, evidence, revisions, pending_revision`), `status = 'ready'`, `week_start >= today - 6`.
3. Read upcoming posts: `calendar_posts` (`id, post_key, plan_id, post_date, platform, format, copy, cta, reasons, touched_at, story_of`), `post_date >= today`.
4. Names in place, for every upcoming post whatever its state: when `plainNames` changes `copy` or `cta`, update the row with `.eq("id", id).eq("copy", was.copy)`. `touched_at` is not set and no revision row is written. Then the same exact replacement on `post_iterations.post_copy` and `cta` for that `calendar_post_key` (rows read first, each updated with `.eq("id", id).eq("post_copy", was)`): a design option carries its caption there. `scheduled_posts` is not touched: what Sprout already holds is outside this plan. Count `renamed`.
5. For each plan with no `pending_revision`: candidates are its posts that are not Stories (`isStoryPost`) and have `replanWhy(...) !== null`; drop the ones `workedOn` (`runWeek.ts:641`) or `revisedByPerson(plan.revisions)` answer for. With at least one left, `db.rpc("calendar_request_revision", { p_plan: plan.id, p_note: REPLAN_NOTE, p_user: null, p_scope: "replan" })`. An error (a revision arrived meanwhile) counts as `busy`.
6. A plan with a `pending_revision` and candidates also counts as `busy`.
7. Return `busy ? { status: "waiting", reason: "in_progress", recheckMinutes: 10, result } : { status: "done", result }` with `result = { renamed, asked: [week_start…], kept }`.

### 5.5 What happens after the deploy, with nobody doing anything
1. The next lifecycle look of each active client finds `accounts` due (its key gained `|own:1`). It parks second accounts and stores display names.
2. `voice` is new for every client with a voice: it queues one `voice_profile` job each. A client whose accounts changed gets a second one only if `voice` ran before the parking; the `inputs` guard on the accounts key prevents that.
3. Each voice job ends with a look. `calendar_recheck` runs: names are corrected, and each week that needs it gets one `week_revise` job of scope `replan`.
4. `runWeekRevise` writes those posts again from fresh evidence under the stage 3 prompt and checks, rebuilds their reasons, and stamps the plan.
5. Later monthly voice rebuilds run `calendar_recheck` again; it finds nothing and makes no model call.

### 5.6 What a re-plan keeps
Posts with an edit (`touched_at`), a saved or approved revision or a design option (`post_iterations`), a design request that is not canceled, or a post sent to Sprout keep their copy (`calendar_post_worked`). So do posts a person's own revision rewrote. A post changed between the read and the write is left alone (`runWeek.ts:743`). Old copy and reasons are kept in `calendar_plans.revisions[].replaced`.

### 5.7 Expected one-time volume (counts of 17 Nov; they will have moved by deploy day)
- 17 voice rebuilds (claude-opus-5-5, one call each).
- About 19 weeks revised across 10 clients, one call each, a second call only when a check refuses. Stored averages per revision: 8,263 input and 3,398 output tokens.
- Posts written again: 60 untouched posts that cite an outside post (of 69; 9 have a design and keep their copy), 12 more untouched posts of the client whose accounts change (22 untouched of 24 upcoming, 10 already counted), and 3 more with time codes (4 in all, one already counted). About 75 of 201 upcoming planned posts.
- Names corrected in place: 5 posts in 3 clients, and 2 design-option rows.
- For the client with two accounts per network: 2 accounts parked (the ones whose whole name is not the client's name), then pillars, trend profile and strategy rewritten by their own steps (about 4 to 5 calls).

Read-only checks after the deploy (SELECT, one statement each, with LIMIT):
- `select client_id, result->'own', result->>'own_dropped_at' from client_lifecycle_steps where step = 'accounts' and result ? 'own' limit 50`
- `select count(*) from clients where archived_at is null and social_voice->>'rule' = '1' limit 1`
- `select p.client_id, p.week_start, r->>'scope', r->>'rewritten', r->'refused' from calendar_plans p, jsonb_array_elements(p.revisions) r where r->>'scope' = 'replan' limit 100`
- `select count(*) from calendar_posts where post_date >= current_date and copy ~ '(^|\s)0?0:00' limit 1` (expect only worked posts)

### 5.8 Tests (stage 4)
- New `supabase/tests/_shared/calendar/replan.test.ts`: `planRules` (absent is 0), `followedAt` (a later finished `replan` revision counts, an `empty` one does not), `replanWhy` for each reason and for none.
- New `supabase/tests/_shared/calendar/migration.replan.test.ts`, in the style of `planCancel.migration.test.ts`: the file drops nothing, restates the function with the same four arguments, accepts the three scopes, keeps the revoke and grant.
- `runWeek.test.ts`: scope `replan` targets only posts with a reason to be rewritten; worked posts and posts a person's revision rewrote are kept; reasons are rebuilt; a Story takes its post's new copy; the plan's `evidence.rules` is stamped; a post refused twice keeps its copy and is listed; `runVoiceProfile` queues a lifecycle look and a failed rpc does not fail the job.
- `steps.test.ts`: `voice` waits for a voice to exist and for `accounts` to carry `|own:1`; its key changes with the profile ids; it queues a job under its own key. `calendar_recheck` waits while a voice job is queued; corrects a decorated name in a worked post and in a design option without setting `touched_at`; asks one revision per week with targets; asks none for a week whose only candidates are worked; answers waiting when a revision is already pending; a second run asks nothing.
- `supabase/tests/_shared/lifecycle/run.test.ts`: the two new steps are queued in a look only when due.

Commit message: `Voices rebuilt and upcoming posts re-planned by the app`

---

## 6. Rule constants and inputs keys (all bumps in one place)

| Constant | File | Value | Used in |
|---|---|---|---|
| `VOICE_RULE` | `_shared/voice/voice.ts` | 1 | `social_voice.rule`; `voice` step key `rule:1|profiles:<ids>`; job key `voice_profile:<client>:rule1:<hash>` |
| `ONE_PER_NETWORK_RULE` | `_shared/lifecycle/accounts.ts` | 1 | `accounts` key `…|own:1[|dup:<networks>]` |
| `COPY_RULE` | `_shared/calendar/copyChecks.ts` | 1 | `calendar_plans.evidence.rules`; `calendar_recheck` key `rules:1|voice:<built_at>|own:<own_dropped_at>` |
| `SHARED_RUN_WORDS` | `copyChecks.ts` | 6 | wording check |
| `SHARED_TRIGRAMS` | `copyChecks.ts` | 5 | wording check |
| `AUTHOR_MIN_CHARS` | `copyChecks.ts` | 5 | author check |
| `TIME_CODES_MAX` | `copyChecks.ts` | 2 | time-code check |
| `NAME_MIN_CHARS` | `_shared/text/displayName.ts` | 3 | decorated names |

Raising `VOICE_RULE` rebuilds every voice once. Raising `COPY_RULE` rechecks every upcoming week once. Raising `ONE_PER_NETWORK_RULE` reruns `accounts` once per client.

New data fields, all inside existing jsonb (no table change): `client_lifecycle_steps.result` of `accounts`: `display_names`, `own`, `own_dropped_at`; `clients.social_voice.rule`; `calendar_plans.evidence.rules` and `evidence.dropped_copy`; `calendar_plans.revisions[].refused` and scope `replan`.

---

## 7. Build order and deploy

Four commits in this order, each green on `npm test` before the next: stage 1, stage 2, stage 3, stage 4. Push them together and deploy once. If they must ship apart, keep the order and ship stage 4 within the same day as stage 2: stage 2 parks accounts at once, and the voice and the calendar follow only with stage 4.

Deploy:
- The migration `20261118110000_calendar_replan.sql`.
- Edge functions that import the changed shared modules: `run-scheduled-jobs`, `calendar-posts`, `sprout-profiles`, `api`, `mcp`, `client-notes`, `design-request`, `generate-ad-hoc-post`, `regenerate-post-copy`.
- The web app is rebuilt as usual (it imports `_shared/voice/voice.ts`, which gains one pure import). No screen changes.

---

## 8. What is exact and what relies on the model

| Part | How it holds |
|---|---|
| Captions and authors of outside posts are not in any planner prompt | Exact: code builds the lines |
| Wording shared with an outside caption; an outside author's name | Exact check before saving |
| Time codes; links and handles that are not the client's | Exact check before saving |
| `refers_to` cites the client's own evidence | The model declares it; code verifies the id |
| A fact retold in new words; an asset claimed in free text with `refers_to` null | Relies on the rule lines |
| One account per network; which one | Exact, recorded with its reason |
| Decorated display names from Sprout's list | Exact replacement at three points |
| A decorated name of someone outside Sprout's list | Not covered |

---

## 9. Risks

- Trend posts become less specific, because the planner sees a subject and a lesson and no caption. This is the intent.
- `lesson`, `angle` and `why_it_matters` are model-written and can carry a detail of an outside post. The wording check compares against captions, so it would not catch that.
- The thresholds (6 words, 5 trigrams) are a judgment. They are named constants with tests; a refused post is listed on the plan (`evidence.dropped_copy`, `revisions[].refused`), so drift can be seen.
- A post refused twice in a re-plan keeps its old copy. It is listed in the revision entry and is not asked again.
- A client whose own posts carry chapters will be told not to write time codes; a first reply that still has them costs one extra call.
- The link check knows a fixed list of domain endings. A bare domain with another ending is not checked.
- Parking stops publishing to the parked account from the app (`schedule-sprout-post/index.ts:48`) and lowers that client's report totals from the next report on.
- The last step of the account order (`oldest`) is arbitrary. The reason is stored in the step result; a person who removes the kept account gets the other one back on the next run.
- A person adding a second account on a network sees it parked within minutes, with no message on the setup page. Showing `result.own[].why` there is a small follow-up, not part of this plan.
- A caption already sent to Sprout keeps a decorated name there; only the calendar post and its design option are corrected. None of the five live posts has been sent.
- The content strategy writer still reads outside captions (`_shared/strategy/write.ts:370-375`). Not calendar copy, so left alone here; a follow-up.
- `design_refs` reruns by itself for the client whose accounts change. Removing reviews of posts the read no longer returns belongs to a sibling builder.
- Existing tests name real clients in fixtures. New tests must not; do not rename the old ones in these commits.

## 10. Critical files
- `supabase/functions/_shared/calendar/weekPlan.ts`
- `supabase/functions/_shared/calendar/runWeek.ts`
- `supabase/functions/_shared/calendar/evidence.ts`
- `supabase/functions/_shared/calendar/copyChecks.ts` (new)
- `supabase/functions/_shared/calendar/replan.ts` (new)
- `supabase/functions/_shared/text/displayName.ts` (new)
- `supabase/functions/_shared/lifecycle/accounts.ts`
- `supabase/functions/_shared/lifecycle/steps.ts`
- `supabase/functions/_shared/lifecycle/socialRead.ts`
- `supabase/functions/_shared/sprout/brands.ts`
- `supabase/functions/_shared/voice/voice.ts`, `supabase/functions/_shared/voice/load.ts`
- `supabase/functions/run-scheduled-jobs/sproutOnboarding.ts`
- `supabase/migrations/20261118110000_calendar_replan.sql` (new)

---

## 11. Changes after the first build (17 Nov 2026, review round)

The sections above are the plan as approved. Four things were changed before release; where they differ from the text above, this section holds.

1. **The migration is `20261118110000_calendar_replan.sql`.** Another branch uses the version `20261118100000`, so the file was renamed.
2. **A voice is rebuilt only when something in it can be wrong** (replaces the `voice` step of 5.4 and the volume of 5.7). Every voice rebuild sets off a trend profile rewrite and a content strategy rewrite by their own keys, so rebuilding every client's voice would cost far more than agreed. The `voice` step now decides from two exact facts: the stored voice still holds one of the decorated display names the `accounts` step lists, or one of the client's own accounts was parked after the voice was built. Otherwise it records in its own result that the voice conforms and writes nothing else: no job, no change to the voice or to the date it was built. Its key is `rule:1|built:<built_at>|own:<own_dropped_at>|names:<hash of the listed names>`, and a rebuild is queued once per stored voice (`voice_profile:<client>:rule1:<hash of built_at>`). `calendar_recheck` runs for every client either way.
3. **Names keep their own symbols** (replaces the pattern of 2.1). Only decoration is removed: `\p{So}` (stars, dingbats, box characters, trademark marks), emoji with their modifiers, and arrows. Mathematical, currency and modifier symbols stay, as do the degree sign and the numero sign.
4. **The parking record is on the row** (replaces `parkedBefore` of 3.1 and how `own_dropped_at` is kept in 3.2). `sprout_profiles` gains `parked_at` and `parked_reason`, added by the same migration. A parked account is `is_active = false` with both set. The `accounts` step reads its decisions and the time an account was last parked from the rows on every run, and the calendar reads the parked time from the rows too, so a failed run or a cleared step result loses nothing. A parked row a person adds back is active with `parked_at` still set, which is how the rule knows a person chose it.

## 12. Changes after the independent review (17 Nov 2026, second review round)

Where this section differs from the text above, this section holds. The migration is unchanged.

1. **Parking never touches an archived client and never guesses** (replaces the "oldest" last resort of 3.1). The lifecycle does not run for an archived client (`run.ts`, all three entry points), and the `accounts` step holds the same line itself. An account is parked only when an exact fact says which account on the network is the brand's own: a person switched a parked account back on, the account's whole name is the client's name, its handle is the client's public profile on that platform, its handle is the one the client's settled account on another network has, or the part of its name before a tagline is the client's name. When the facts leave more than one account, nothing is parked, every account stays in use, and the step records the choice as open (`own_open`). A personal LinkedIn profile is outside the rule: a company page and its people's profiles stay together (`parkingNetwork`). The rule works only among the accounts the client had when the rule began (`OWN_RULE_SINCE`, the release day) and the rows the rule itself parked. From then on the matcher never assigns a profile on a network where the client has an account, nor two profiles on one network in one run (they are listed as `skipped`), so an account that appears later can only be a person's choice: it is never parked and never parks another.
2. **The setup page says what happened.** The accounts list of the setup page shows a parked account in a "Not used" group, with the reason stored on its row and an "Add it back" button. An account added back is saved with the page like any account a person adds; its row keeps the parking record, which is how the rule knows a person chose it.
3. **Time codes mean chapters, not clock times** (replaces `timeCodes` and `TIME_CODES_MAX` of 4.3). `chapterList` is true for exactly: a line that starts with the zero time and a label; two or more lines that each start with a time and a label, in ascending order, the first within `CHAPTER_START_MAX_SECONDS` (59) of zero; or, on one line, the zero time with a label and a later time with a label. Clock times, time ranges, opening hours and an event's schedule are never refused. The re-plan trigger (`replan.ts`, reason `chapters`) uses the same function.
4. **A person's note is the person's instruction.** In a revision a person asked for, a link host or a handle written in the note counts as the client's own for that revision. A refused rewrite records which check refused it (`kind`), and the week's existing status line says how many posts were kept as they were and why, in one sentence.
5. **A voice rebuild cannot chain** (replaces the job key of section 11, item 2). One rebuild is asked per set of facts: the rule, the listed names with their plain forms, and the time an account was last parked. The job's key is made of those facts and nothing else. When the rebuild for the facts has been made and the voice still holds a listed name, the names are written plainly in the stored text in code, the date the voice was built stays, and the step is done.
6. **A name is shortened only when the short form is known to be the name** (replaces the tagline cut of 2.1). `plainDisplayName(name, known)` cuts at the first tagline separator only when the part before it equals, by `sameName`, one of the known names: the name of a client that holds the profile, the profile's Sprout group name, or the name of another profile of the same owner on another network. Otherwise the whole display name is the name and only decoration is removed. The accounts step stores each listed name with its plain form (`display_names: [{ name, plain }]`), and every reader replaces by that pair. The same guard holds in the split naming of `brands.ts` and in the `name_cut` fact.
7. **The asset rule counts all of the client's own material the planner holds.** The planner receives the client's own posts (P), its report (R), its pillars, its content strategy when it has one, and the voice section (what the client told the team, and its own example posts). The rule names exactly those, and `refers_to.evidence_id` may be a P or R id, `"notes"`, `"pillars"`, `"strategy"` or `"voice"`; the code check accepts the last three only when the prompt held them.
8. **The split never creates a client.** A part of a Sprout group that holds two brands is never created by the onboarding job. When the group already is a client, the other part is left with the decision `group_client`; when it is no client yet, every part is left with `group_split`. A person adds one from the profile list.

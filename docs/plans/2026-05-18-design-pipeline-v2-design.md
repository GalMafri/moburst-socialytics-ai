# Design Pipeline v2 — Design Doc

**Date:** 2026-05-18
**Status:** Approved
**Author:** Claude Code (collaboration with @GalMafri)

## Why

The current image and video generation pipeline produces designs that look color-by-numbers: brand hex codes get applied, but nothing else about the brand comes through. Three root causes:

1. **Client context is broken end-to-end.** [`ReportView.tsx:73`](src/pages/ReportView.tsx:73) only fetches `clients(name, brand_identity)`. Design references, brand book, content pillars, brief text, brand notes never reach the generation calls. The components accept these as props but they're always undefined.
2. **The prompt itself sabotages output quality.** [`generate-post-image/index.ts:225`](supabase/functions/generate-post-image/index.ts:225) writes hex codes into the prompt with strong language telling the model not to render them — so the model treats the hex strings as the most concrete design instruction and renders them as visible text. A defensive Anthropic-vision retry catches some leaks but doesn't fix the root cause.
3. **Platform best-practices are one-liners.** Each platform gets ~1 line of guidance ("LinkedIn — professional, polished"). No safe zones, no aspect-specific composition rules, no per-format playbook.

Plus two product-level gaps:
- No way to generate multiple design variants for the same post. "Regenerate" overwrites instead of compares.
- The Content Ideas tab has overlapping Content Recommendations + Calendar views, 6+ buttons per post card with no primary action, and post status (designed? scheduled?) is invisible.

## Goal

Build a design generation pipeline where every client's full design context reaches the model, the brand's actual design language drives outputs (not its hex codes), users can compare multiple creative variants, and the Content Ideas tab is the calm primary surface for the whole creative-to-schedule workflow.

## Non-goals

- Replacing the n8n analysis pipeline (we extend it, not rewrite it)
- Replacing the existing `DesignEditor` / `VideoTrimmer` (we integrate them into the new panel)
- Changes to auth, RLS, copy-learning (`analyze-post-edits` / `brand_voice_learnings`), Sprout scheduling internals, or scheduled-report cron
- A test suite buildout (the repo has no real tests today; this work adds smoke tests only for new pure-logic modules)
- Pricing/cost visibility in the UI — clients use this app; per-action costs stay invisible

---

## Architecture overview

The work is structured as **seven layered changes**. Each layer is independently shippable and reversible.

```
┌────────────────────────────────────────────────────────────────────┐
│  L1  Context plumbing — full clients row → ReportView → components │
│      → edge functions. No more dropped fields.                     │
├────────────────────────────────────────────────────────────────────┤
│  L2  Visual style synthesis — Claude vision-on-design-refs writes  │
│      a structured 9-field design language descriptor to            │
│      clients.design_style_synthesis. Once per client per change.   │
├────────────────────────────────────────────────────────────────────┤
│  L3  New prompt builders for image + video. No hex codes in        │
│      prompt text. Design language synthesis as primary brief.      │
│      Platform playbook with real best-practices.                   │
├────────────────────────────────────────────────────────────────────┤
│  L4  Multi-variant generation — N parallel calls with distinct     │
│      creative angles (Claude-proposed). User picks favorite(s).    │
│      Variants persisted under shared variant_group_id.             │
├────────────────────────────────────────────────────────────────────┤
│  L5  Content Ideas tab redesign — 7-column kanban, single primary  │
│      action per card opens a side panel with                       │
│      Copy/Design/Video/Schedule sub-tabs. Status chips.            │
├────────────────────────────────────────────────────────────────────┤
│  L6  Schema additions — design_style_synthesis on clients,         │
│      variant_group_id / is_selected / variant_angle / is_approved  │
│      / approved_at / approved_by on post_iterations. Indexes.      │
├────────────────────────────────────────────────────────────────────┤
│  L7  n8n workflow update — AI Synthesis Agent receives             │
│      design_style_synthesis; visual_direction speaks the brand's   │
│      design language; hex codes banned from visual_direction.      │
└────────────────────────────────────────────────────────────────────┘
```

---

## L1 — Context plumbing

**The fix.** `ReportView.tsx:73` expands the query to fetch the full client context, builds a single `clientContext` object, and passes it as one prop. The edge functions accept and *use* every field.

**Frontend changes**
- [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx) — expand select to `clients(id, name, brand_identity, design_references, brand_book_file_path, brand_book_url, content_pillars, brief_text, brand_notes, geo, language, timezone, design_style_synthesis)`. Build one `clientContext` object.
- [`src/components/reports/CreatePostDesignButton.tsx`](src/components/reports/CreatePostDesignButton.tsx) — accept `clientContext` prop, forward as one body field.
- [`src/components/reports/CreatePostVideoButton.tsx`](src/components/reports/CreatePostVideoButton.tsx) — same.
- [`src/components/reports/CreateAdHocPost.tsx`](src/components/reports/CreateAdHocPost.tsx) — same.

**Edge function changes**
- [`supabase/functions/generate-post-image/index.ts`](supabase/functions/generate-post-image/index.ts) — accept and use full `client_context`. Fetch the brand book file from `brand-books` storage (Gemini 3.1 accepts inline PDFs ≤4MB).
- [`supabase/functions/generate-post-video/index.ts`](supabase/functions/generate-post-video/index.ts) — same shape.

**Why first.** Every subsequent layer needs context to actually arrive at the model. Shipping this alone — with no other changes — will already lift output quality measurably.

---

## L2 — Visual style synthesis

**One edge function, run once per client per change.** Reads up to 8 design refs + brand book, sends them to Claude Sonnet with a structured-output vision prompt, writes a JSON descriptor back to `clients.design_style_synthesis`.

**Structured output (9 sections)**
1. `composition_patterns` — layout, focal points, asymmetry/symmetry, breathing room
2. `typography_treatment` — hierarchy, weight contrast, type-on-image rules
3. `imagery_style` — photo vs illustration, lighting, color grading, framing distance
4. `color_usage` — qualitative palette application (no hex codes), when bold vs subtle, ground vs accent
5. `surface_and_texture` — flat, gradient, grain, glass, etc.
6. `logo_and_marks_treatment` — when used, scale, placement (critical: stops Gemini from inventing giant logos)
7. `mood_and_voice_visual` — energetic, restrained, premium, playful — with concrete cues
8. `anti_patterns` — don't do this (per the observed refs)
9. `platform_adaptations` — how the style adapts per platform

**Trigger pattern.** Debounced auto-trigger 10 seconds after the last design ref upload or brand book change. Manual "Re-run synthesis" button always available. Status surfaced in [`src/components/onboarding/DesignReferencesUpload.tsx`](src/components/onboarding/DesignReferencesUpload.tsx) (or sibling). If synthesis fails, status shows "Synthesis failed — re-run"; generation degrades gracefully to `brand_identity` only.

**Storage at use time.** Section names become labeled prose ("## Composition\n…\n## Typography\n…") when injected into a generation prompt — Gemini handles section headers better than JSON.

**New files**
- `supabase/functions/synthesize-design-language/index.ts`
- `src/components/onboarding/DesignSynthesisCard.tsx` (or inline in `DesignReferencesUpload.tsx`)

---

## L3 — New prompt builders

**Why the current prompt fails.** [`buildDesignPrompt`](supabase/functions/generate-post-image/index.ts:186) writes hex codes into the prompt then asks the model not to render them. The hex codes are the most concrete strings in the prompt; the model renders them. Removing them from the prompt entirely solves it at the source.

**New structured layered prompt.** Sections in fixed order (LLMs weight early tokens higher):

1. **Creative direction** — post pillar, copy, visual_direction, hook, CTA (1 paragraph, no rules)
2. **Brand design language** — flattened `design_style_synthesis` (9 sections, labeled headers)
3. **Platform & format playbook** — per-platform/format best-practices block (real safe zones, aspect ratios, scroll-stopping framing, etc.). Source: new TypeScript data file [`src/lib/platform-design-playbook.ts`](src/lib/platform-design-playbook.ts) so it's editable without edge-function redeploys.
4. **Composition checklist** — 3-4 bullets derived from the post type (carousel cover vs interior; story vs feed; reel cover vs static)
5. **Color palette** — one short line: "Underlying palette: brand primary, secondary, accent. Apply per the design language above." **No hex codes.**
6. **Variant angle** — for multi-variant: one creative-angle instruction unique per variant (Section 4)
7. **Hard constraints (short)** — no logo invention, no fake brand text, no rendered color codes

**Multimodal inputs (alongside text prompt):**
- Up to 4 design refs as inline images
- Brand book as inline file (Gemini 3.1 supports inline PDFs ≤4MB)

**Hex-code defense in depth:**
- **Prompt-level:** no hex codes appear in any prompt text we send (synthesis describes colors qualitatively; `stripHexFromText` still sanitizes any free-text inputs)
- **Output-level:** `validate-design-output` retry kept as a thin safety net. Should rarely trigger after the prompt-level fix, but the failure mode (literal hex strings rendered on the design) is severe enough that the ~1s of extra latency is worth it.

**Video.** Same layered approach in [`generate-post-video`](supabase/functions/generate-post-video/index.ts). Claude distillation in [`adapt-creative-prompt`](supabase/functions/adapt-creative-prompt/index.ts) receives full context. Platform-specific motion guidance per playbook. If Veo supports image-to-video on the active model, top design ref seeds the first frame.

**New files**
- `src/lib/platform-design-playbook.ts`
- `supabase/functions/propose-design-angles/index.ts` (used by L4)

**Removed**
- The hex-code metadata block in the current prompt builder
- The "USE BUT DON'T DISPLAY" defensive language

---

## L4 — Multi-variant generation

**Flow.**
1. User clicks "Design" → modal opens
2. Modal shows: editable prompt, variant count slider (2-6, default 4), "Suggested angles" checkbox list
3. On Generate:
   - First call: `propose-design-angles` returns 6 creative angles for this post (Claude, ~2s)
   - UI pre-checks the top N (matching variant count); user can adjust
   - N parallel `generate-post-image` calls fire, each with the same brief + design language + one unique angle in section 6
4. UI shows N skeleton cards filling in out-of-order (placed in fixed positions)
5. User selects favorite(s) — click toggles favorite; favorited variant(s) become the post's `media_urls`; non-favorited variants persist in `post_iterations` with `is_selected = FALSE`

**Variant differentiation.** Different creative angles, not just different seeds. Same brief generated 4 times tends to converge; angle-led variants actually offer choice.

**Data model.** Extend `post_iterations` rather than add a new table. A "variant set" = rows sharing a `variant_group_id`. Existing rows with `variant_group_id IS NULL` are singletons. `is_selected` defaults to TRUE so old rows continue to render.

**Carousel + variants.** A "variant" for a carousel = a full N-slide carousel concept. User picks one concept; its slides become `media_urls`. Default variant count for carousels capped at 2 (overrideable to 4) because of the multiplier.

**Video.** Same pattern. Default variant count 2 (Veo is expensive in wall-clock time).

**Files**
- Rewrite: [`src/components/reports/CreatePostDesignButton.tsx`](src/components/reports/CreatePostDesignButton.tsx)
- Modify: [`src/components/reports/CreatePostVideoButton.tsx`](src/components/reports/CreatePostVideoButton.tsx)
- Modify: [`supabase/functions/generate-post-image/index.ts`](supabase/functions/generate-post-image/index.ts) — accept optional `variant_angle`
- New: `supabase/functions/propose-design-angles/index.ts`

**Risk.** Failed variants: if one of N parallel calls fails, others still complete; failed slots show "Failed — retry" instead of blocking the batch.

---

## L5 — Content Ideas tab redesign

**What goes away.** The standalone "Content Recommendations" block at the top. Its insights fold into a collapsible "Weekly highlights" row above the kanban.

**Layout.** 7-column horizontal kanban (Mon–Sun), platform-grouped post cards in each column. On `<lg` screens, collapses to vertical stack with sticky day headers.

**Post card (collapsed — the everyday surface).**
- Top: platform badge, format badge, language badge, posting time
- Middle: 2-line truncated copy preview
- Below: thumbnail of currently-selected variant (or "+ Design" placeholder)
- Bottom: status chip · overflow `⋮` menu
- **One primary gesture: click the card → side panel opens.** No buttons on the card itself.

**Side panel (right-side Sheet, ~640px).** Four sub-tabs:
- **Copy** — inline edit, hashtags, CTA, rationale, why-this insight. Edits route to existing `analyze-post-edits` → `brand_voice_learnings` flow (untouched).
- **Design** — variant grid, favorite-selection, "Edit in Canvas" opens existing [`DesignEditor`](src/components/editor/DesignEditor.tsx). Generate / Regenerate.
- **Video** — same pattern with [`VideoTrimmer`](src/components/editor/VideoTrimmer.tsx).
- **Schedule** — existing [`SchedulePostModal`](src/components/reports/SchedulePostModal.tsx) content lifted in place (modal becomes a tab section).

**Status chip values.**
- `Draft` — no design yet
- `Designed` — at least one variant selected (computed from `media_urls.length > 0 AND is_selected`)
- `Approved` — staff/admin one-click; persisted to `is_approved`. Clients see read-only.
- `Scheduled` — `schedule-sprout-post` succeeded; computed from `scheduled_posts` join
- `Published` — surfaced later if Sprout reports it back (out of scope for this work)

**Filters.** Sticky chip row above kanban: day · platform · status · language. Day filter scrolls; platform/status/language fade non-matching cards rather than hiding them (preserves spatial map).

**Realtime.** New scoped hook `useRealtimePostIterations(clientId)` — additive, doesn't touch the existing [`useRealtimeReports`](src/hooks/useRealtimeReport.ts).

**Role behavior preserved.** Clients don't see Approve or Schedule. Hidden by `useAuth.isClient` checks (same pattern as the existing Gamma deck banner gating).

**PDF export preserved.** [`ExportPdfButton`](src/components/reports/ExportPdfButton.tsx) keeps working. New components get `print:` Tailwind variants to flatten side-panel content into a stacked list in print mode.

**New files**
- `src/components/reports/calendar/ContentIdeasTab.tsx`
- `src/components/reports/calendar/CalendarKanban.tsx`
- `src/components/reports/calendar/PostCard.tsx`
- `src/components/reports/calendar/PostPanel.tsx`
- `src/components/reports/calendar/PostStatusChip.tsx`
- `src/components/reports/calendar/WeeklyHighlights.tsx`
- `src/components/reports/calendar/CalendarFilters.tsx`
- `src/hooks/useRealtimePostIterations.ts`

**Modified**
- [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx) — replaces the inline Content Ideas JSX with `<ContentIdeasTab />`. ReportView shrinks substantially (audit flagged its size as a risk — this extraction is a side-benefit).

---

## L6 — Schema additions (already applied)

Applied via the Lovable SQL editor. All idempotent.

```sql
alter table public.clients
  add column if not exists design_style_synthesis jsonb;

alter table public.post_iterations
  add column if not exists variant_group_id uuid,
  add column if not exists is_selected boolean default true,
  add column if not exists variant_angle text,
  add column if not exists is_approved boolean default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id);

create index if not exists idx_post_iterations_variant_group
  on public.post_iterations(variant_group_id);
create index if not exists idx_post_iterations_client_report
  on public.post_iterations(client_id, report_id);
```

**No backfill needed.** PG applies defaults to existing rows at column-add time. Existing iterations have `is_selected = TRUE` (singleton), `is_approved = FALSE`, `variant_group_id = NULL`.

**No RLS work.** New columns inherit existing table policies.

`src/integrations/supabase/types.ts` will regenerate via Lovable. If stale, hand-patched with new fields; minimal targeted diff.

---

## L7 — n8n workflow update

The AI Synthesis Agent that generates the calendar needs `design_style_synthesis` so the `visual_direction` it produces speaks the brand's actual design language — not just colors.

**Two surgical edits** to `Socialytics - AI Social Media Trend Analysis + Insights Agent - Loveable - Final.json`:

1. **`Build Normalized Client Object`** — extend the `context` object:
   ```js
   design_style_synthesis: clientData.design_style_synthesis || null,
   has_design_references: Array.isArray(clientData.design_references) && clientData.design_references.length > 0,
   has_brand_book: !!clientData.brand_book_file_path,
   ```

2. **`AI Synthesis Agent` system message** — new section between `## BRAND BOOK GUIDELINES` and `## LANGUAGE & REGION REQUIREMENTS`:
   ```
   ## BRAND DESIGN LANGUAGE
   {{ $json.context.design_style_synthesis
     ? 'The client\'s extracted design language is: ' + JSON.stringify($json.context.design_style_synthesis) +
       '. EVERY ai_visual_prompt and visual_direction MUST be written in alignment with these patterns — composition, typography, imagery, color usage, surface, logo treatment, mood, and platform adaptations. Do NOT include hex color codes anywhere in visual_direction or ai_visual_prompt — describe colors qualitatively (e.g., "warm coral accent on a deep navy ground") because hex codes leak into rendered images downstream.'
     : 'No extracted design language available. Use general best-practices and the brand_voice + brand_book_text above for visual direction.' }}
   ```

User re-imports the workflow JSON into n8n manually after edit.

---

## Build sequence

Eight commits in order. Each independently verifiable in the Lovable preview, each reversible by `git revert`.

| # | Ship | Risk | Verify |
|---|------|------|--------|
| 1 | Migration columns (done) | — | Verified by user via `information_schema.columns` |
| 2 | Context plumbing (L1) | Low | Generate a design on a client; check Supabase logs show full context body |
| 3 | New prompt builders + brand book multimodal attachment (L3) | Med | Side-by-side compare 3-5 generations pre/post on the same post; spot-check for hex leakage |
| 4 | Synthesis edge function + UI (L2) | Low | Upload refs → synthesis fires → check `clients.design_style_synthesis` populated → re-run a generation, confirm synthesis text in Gemini logs |
| 5 | Multi-variant generation — images (L4 part 1) | Med | Generate 4 variants on a test post; verify saved as `post_iterations` with shared `variant_group_id`; favorite-selection updates `is_selected` |
| 6 | Multi-variant generation — video (L4 part 2) | Med | Generate 2 video variants; verify saved; favorite-selection works |
| 7 | Content Ideas tab redesign (L5) | High | End-to-end on a test client: card click → side panel → copy edit → design generate → schedule. PDF export still works. Client role view (no approve, no schedule). |
| 8 | n8n workflow update (L7) | Low | Trigger fresh report; confirm `visual_direction` speaks the brand's design language and has no hex codes |

**Branch strategy.** Single feature branch `feat/design-pipeline-v2` off `main`. Each phase its own commit. PR opened at phase 4 for early review, kept open through phase 8.

## What this design does NOT touch

Explicit guardrails:
- `useAuth` and `hub-auth-bridge` (auth flow)
- `analyze-post-edits` + `brand_voice_learnings` (copy-learning loop)
- `trigger-scheduled-reports` (cron)
- `schedule-sprout-post` write path
- `useRealtimeReports` channel (new realtime hook is additive)
- `ExportPdfButton` (print styles added to new components)
- `clients.brand_identity` shape (only additive `design_style_synthesis`)
- Any destructive DB operation

## Rollback

Migrations are additive only; edge function changes deploy per commit. Roll back any phase with `git revert` of the offending commit and Lovable re-sync. No data loss.

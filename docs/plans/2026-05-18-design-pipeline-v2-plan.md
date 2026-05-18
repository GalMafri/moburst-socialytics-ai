# Design Pipeline v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a brand-language-faithful design and video generation pipeline with multi-variant comparison, plus a redesigned Content Ideas calendar with status tracking and a unified side panel.

**Architecture:** Seven layered changes. Each commit ships one verifiable piece. Pure logic (prompt builders, playbook lookups) lives in `supabase/functions/_shared/` and is unit-tested from `src/test/`. Edge functions and UI verified manually in the Lovable preview after each push.

**Tech Stack:** TypeScript, React (Vite), shadcn/ui, Tailwind CSS, Supabase (Deno edge functions, Postgres, Storage, Realtime), Gemini 3.1 Flash Image (Nano Banana 2), Google Veo, Anthropic Claude (haiku/sonnet), n8n.

**Branch:** `feat/design-pipeline-v2` (already created, design doc already committed).

**Companion design doc:** [`docs/plans/2026-05-18-design-pipeline-v2-design.md`](2026-05-18-design-pipeline-v2-design.md)

---

## Table of contents

1. [Phase 0 — Prerequisites (already done)](#phase-0--prerequisites-already-done)
2. [Phase 1 — Context plumbing (L1)](#phase-1--context-plumbing-l1)
3. [Phase 2 — Platform playbook (L3 part 1)](#phase-2--platform-playbook-l3-part-1)
4. [Phase 3 — Image prompt builder (L3 part 2)](#phase-3--image-prompt-builder-l3-part-2)
5. [Phase 4 — Video prompt builder (L3 part 3)](#phase-4--video-prompt-builder-l3-part-3)
6. [Phase 5 — Synthesis edge function + UI (L2)](#phase-5--synthesis-edge-function--ui-l2)
7. [Phase 6 — Multi-variant images (L4 part 1)](#phase-6--multi-variant-images-l4-part-1)
8. [Phase 7 — Multi-variant video (L4 part 2)](#phase-7--multi-variant-video-l4-part-2)
9. [Phase 8 — Content Ideas tab redesign (L5)](#phase-8--content-ideas-tab-redesign-l5)
10. [Phase 9 — n8n workflow update (L7)](#phase-9--n8n-workflow-update-l7)

---

## Conventions used in this plan

- **File paths are exact and absolute from the repo root.** When a task says "Create `supabase/functions/foo/index.ts`", that's the literal path.
- **Test-first where feasible.** Pure-logic modules get vitest tests written before implementation. Edge function entry points and UI get manual verification.
- **Commit per task.** Each task ends with a single commit. Push at the end of each phase (or sooner if you want intermediate Lovable previews).
- **Lovable deploys on push.** Edge functions and frontend code go live within a minute of push to `feat/design-pipeline-v2`. Migrations have already been applied directly.
- **Console.log breadcrumbs** in edge functions are encouraged for verification — Supabase function logs are visible via Lovable's Project Settings → Supabase → Functions → Logs.
- **Sanitization preserved.** [`stripHexFromText`](src/utils/sanitizeDesignPrompt.ts) is still used on any free-text input that may contain hex codes.

---

## Phase 0 — Prerequisites (already done)

The database migration has been applied directly to the Lovable-managed Supabase project. The seven new columns and two indexes from the design doc are live:

- `clients.design_style_synthesis jsonb`
- `post_iterations.variant_group_id uuid`
- `post_iterations.is_selected boolean default true`
- `post_iterations.variant_angle text`
- `post_iterations.is_approved boolean default false`
- `post_iterations.approved_at timestamptz`
- `post_iterations.approved_by uuid references auth.users(id)`
- `idx_post_iterations_variant_group`
- `idx_post_iterations_client_report`

The design doc is committed to `feat/design-pipeline-v2`. Continue from there.

---

## Phase 1 — Context plumbing (L1)

**Goal:** Every field on the `clients` table that has design value reaches the image and video generation edge functions. Today, only `brand_identity` does.

**Files touched in this phase:**
- Modify: [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx)
- Modify: [`src/components/reports/CreatePostDesignButton.tsx`](src/components/reports/CreatePostDesignButton.tsx)
- Modify: [`src/components/reports/CreatePostVideoButton.tsx`](src/components/reports/CreatePostVideoButton.tsx)
- Modify: [`src/components/reports/CreateAdHocPost.tsx`](src/components/reports/CreateAdHocPost.tsx)
- Modify: [`supabase/functions/generate-post-image/index.ts`](supabase/functions/generate-post-image/index.ts)
- Modify: [`supabase/functions/generate-post-video/index.ts`](supabase/functions/generate-post-video/index.ts)
- Create: `src/lib/clientContext.ts` — shared type and helper

---

### Task 1.1: Define the shared `ClientContext` type

**Files:**
- Create: `src/lib/clientContext.ts`

**Step 1: Create the file**

```ts
// src/lib/clientContext.ts
// Single shape for everything a generation call needs to know about the client.
// Built once in ReportView (or wherever the client row is fetched) and passed
// down through props.

import type { BrandIdentity } from "@/components/reports/CreatePostDesignButton";

export interface ClientContext {
  client_id: string;
  client_name: string;
  brand_identity: BrandIdentity | null;
  design_references: string[];          // storage paths in design-references bucket
  brand_book_file_path: string | null;  // storage path in brand-books bucket
  brand_book_url: string | null;
  content_pillars: ContentPillar[];
  brief_text: string | null;
  brand_notes: string | null;           // may contain [VOICE:preset]\n prefix
  geo: string[];                        // parsed from comma-separated
  languages: string[];                  // parsed from comma-separated
  timezone: string;
  design_style_synthesis: DesignStyleSynthesis | null;
}

export interface ContentPillar {
  name: string;
  description: string;
}

export interface DesignStyleSynthesis {
  composition_patterns?: string;
  typography_treatment?: string;
  imagery_style?: string;
  color_usage?: string;
  surface_and_texture?: string;
  logo_and_marks_treatment?: string;
  mood_and_voice_visual?: string;
  anti_patterns?: string;
  platform_adaptations?: string;
  synthesized_at?: string;             // ISO timestamp
  source_count?: number;               // how many refs were used
}

/**
 * Parse a comma-separated string into an array, trimming and filtering empties.
 * Handles strings like "US, UK" → ["US", "UK"]. Returns an empty array for
 * null/empty input.
 */
export function parseCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Strip the [VOICE:preset] prefix from brand_notes if present.
 * The voice preset is stored separately; brand_notes is the freeform notes only.
 */
export function stripVoicePreset(brandNotes: string | null | undefined): string | null {
  if (!brandNotes) return null;
  return brandNotes.replace(/^\[VOICE:[^\]]+]\n?/, "") || null;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /tmp/moburst-socialytics-ai && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing unrelated errors).

**Step 3: Commit**

```bash
git add src/lib/clientContext.ts
git commit -m "feat(types): add shared ClientContext shape for generation calls"
```

---

### Task 1.2: Expand ReportView query and build `clientContext`

**Files:**
- Modify: [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx) lines 68-98

**Step 1: Replace the report query**

Find the current query at [`src/pages/ReportView.tsx:68-80`](src/pages/ReportView.tsx:68):

```ts
const { data: report, isLoading } = useQuery({
  queryKey: ["report", reportId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("reports")
      .select("*, clients(name, brand_identity)")
      .eq("id", reportId!)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  enabled: !!reportId,
});
```

Replace with:

```ts
const { data: report, isLoading } = useQuery({
  queryKey: ["report", reportId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("reports")
      .select(`
        *,
        clients (
          id, name, brand_identity, design_references,
          brand_book_file_path, brand_book_url,
          content_pillars, brief_text, brand_notes,
          geo, language, timezone, design_style_synthesis
        )
      `)
      .eq("id", reportId!)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  enabled: !!reportId,
});
```

**Step 2: Build the `clientContext` object after the report loads**

Find the block at [`src/pages/ReportView.tsx:95-99`](src/pages/ReportView.tsx:95):

```ts
const rawRd = report.report_data as any;
const rd = Array.isArray(rawRd) ? rawRd[0] : rawRd;
const clientName = (report as any).clients?.name || "Client";
const brandIdentity = (report as any).clients?.brand_identity || null;
```

Insert below it:

```ts
// Build the full client context once, pass down via props.
const clientRow = (report as any).clients || {};
const clientContext: ClientContext = {
  client_id: clientRow.id || id || "",
  client_name: clientRow.name || "Client",
  brand_identity: clientRow.brand_identity || null,
  design_references: Array.isArray(clientRow.design_references)
    ? (clientRow.design_references as string[])
    : [],
  brand_book_file_path: clientRow.brand_book_file_path || null,
  brand_book_url: clientRow.brand_book_url || null,
  content_pillars: Array.isArray(clientRow.content_pillars)
    ? (clientRow.content_pillars as ContentPillar[])
    : [],
  brief_text: clientRow.brief_text || null,
  brand_notes: stripVoicePreset(clientRow.brand_notes),
  geo: parseCsv(clientRow.geo),
  languages: parseCsv(clientRow.language),
  timezone: clientRow.timezone || "UTC",
  design_style_synthesis: clientRow.design_style_synthesis || null,
};
```

**Step 3: Add the import at the top of `ReportView.tsx`**

Find the imports block and add:

```ts
import {
  parseCsv,
  stripVoicePreset,
  type ClientContext,
  type ContentPillar,
} from "@/lib/clientContext";
```

**Step 4: Verify TS compiles**

Run: `cd /tmp/moburst-socialytics-ai && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

**Step 5: Commit**

```bash
git add src/pages/ReportView.tsx
git commit -m "feat(reports): fetch full client context and build ClientContext in ReportView"
```

---

### Task 1.3: Add `clientContext` prop to `CreatePostDesignButton`

**Files:**
- Modify: [`src/components/reports/CreatePostDesignButton.tsx`](src/components/reports/CreatePostDesignButton.tsx)

**Step 1: Add the prop and the import**

At the top of the file, add to the imports:

```ts
import type { ClientContext } from "@/lib/clientContext";
```

Modify the `CreatePostDesignButtonProps` interface at [`src/components/reports/CreatePostDesignButton.tsx:25-38`](src/components/reports/CreatePostDesignButton.tsx:25):

```ts
interface CreatePostDesignButtonProps {
  post: {
    ai_visual_prompt?: string;
    visual_direction?: string;
    copy?: string;
    platform?: string;
    format?: string;
    pillar?: string;
    language?: string;
  };
  /**
   * Full client context. Pass the object built in ReportView. Optional only
   * for backwards compat — components without it fall back to brandIdentity.
   */
  clientContext?: ClientContext;
  /** @deprecated — prefer clientContext.brand_identity */
  brandIdentity?: BrandIdentity | null;
  /** @deprecated — prefer clientContext.design_references */
  designReferences?: string[];
  /** @deprecated — prefer clientContext.brand_book_file_path */
  brandBookFilePath?: string;
  clientId?: string;
  onImagesGenerated?: (urls: string[]) => void;
}
```

**Step 2: Read both new and legacy props**

After the function signature `export function CreatePostDesignButton({ ... })`, before the existing destructure body, derive the effective context:

```ts
// Prefer clientContext when provided; fall back to legacy individual props.
const effectiveBrandIdentity = clientContext?.brand_identity ?? brandIdentity ?? null;
const effectiveDesignReferences = clientContext?.design_references ?? designReferences ?? [];
const effectiveBrandBookFilePath = clientContext?.brand_book_file_path ?? brandBookFilePath ?? null;
```

Replace all uses of `brandIdentity`, `designReferences`, `brandBookFilePath` inside the function body with their `effective*` equivalents.

**Step 3: Update the edge-function invoke body to pass the full context**

Find the two `supabase.functions.invoke("generate-post-image", { body: { ... } })` calls (around [`src/components/reports/CreatePostDesignButton.tsx:109-118`](src/components/reports/CreatePostDesignButton.tsx:109) and again in the retry block around line 136). Replace each `body` with:

```ts
body: {
  prompt: slidePrompt,
  platform: post.platform,
  format: post.format,
  // Legacy fields for backward compat — edge function still reads them as fallback.
  brand_context: effectiveBrandIdentity || undefined,
  design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
  brand_book_file_path: effectiveBrandBookFilePath || undefined,
  // New: full structured context.
  client_context: clientContext || undefined,
  post: {
    pillar: post.pillar,
    language: post.language,
    visual_direction: post.visual_direction,
    copy: post.copy,
  },
}
```

**Step 4: Verify TS**

Run: `cd /tmp/moburst-socialytics-ai && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

**Step 5: Commit**

```bash
git add src/components/reports/CreatePostDesignButton.tsx
git commit -m "feat(reports): forward full clientContext into generate-post-image calls"
```

---

### Task 1.4: Same change in `CreatePostVideoButton`

**Files:**
- Modify: [`src/components/reports/CreatePostVideoButton.tsx`](src/components/reports/CreatePostVideoButton.tsx)

**Step 1: Update props interface**

Add the import and modify the props:

```ts
import type { ClientContext } from "@/lib/clientContext";

interface CreatePostVideoButtonProps {
  post: any;
  clientContext?: ClientContext;
  /** @deprecated — prefer clientContext.brand_identity */
  brandIdentity?: any;
  clientId?: string;
  onVideoGenerated?: (url: string) => void;
}
```

**Step 2: Derive effective brand identity** at the top of the function body:

```ts
const effectiveBrandIdentity = clientContext?.brand_identity ?? brandIdentity ?? null;
```

Replace all uses of `brandIdentity` with `effectiveBrandIdentity` inside the function.

**Step 3: Update the invoke body for `generate-post-video`** at around [`src/components/reports/CreatePostVideoButton.tsx:188-196`](src/components/reports/CreatePostVideoButton.tsx:188):

```ts
const { data, error } = await supabase.functions.invoke("generate-post-video", {
  body: {
    prompt,
    platform: post.platform,
    format: post.format,
    brandIdentity: effectiveBrandIdentity,    // legacy field name kept for compat
    client_context: clientContext || undefined,
    post: {
      pillar: post.pillar,
      language: post.language,
      visual_direction: post.visual_direction,
      copy: post.copy,
    },
  },
});
```

**Step 4: TS check**

Run: `cd /tmp/moburst-socialytics-ai && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

**Step 5: Commit**

```bash
git add src/components/reports/CreatePostVideoButton.tsx
git commit -m "feat(reports): forward full clientContext into generate-post-video calls"
```

---

### Task 1.5: Same change in `CreateAdHocPost`

**Files:**
- Modify: [`src/components/reports/CreateAdHocPost.tsx`](src/components/reports/CreateAdHocPost.tsx)

**Step 1: Update props**

```ts
import type { ClientContext } from "@/lib/clientContext";

interface CreateAdHocPostProps {
  clientId: string;
  platforms: string[];
  clientContext?: ClientContext;
  /** @deprecated — prefer clientContext.brand_identity */
  brandIdentity?: any;
  onPostCreated?: (post: any) => void;
}
```

**Step 2: In the function body, derive effective brand identity, and pass `clientContext` down to the embedded `<CreatePostDesignButton />` and `<CreatePostVideoButton />`** (currently at lines ~309 and ~321):

```tsx
<CreatePostDesignButton
  post={{
    visual_direction: generatedPost.visual_direction,
    ai_visual_prompt: generatedPost.visual_direction,
    copy: generatedPost.caption_angle,
    platform: generatedPost.platform,
    format: generatedPost.format,
    pillar: generatedPost.pillar,
    language: generatedPost.language,
  }}
  clientContext={clientContext}
  clientId={clientId}
/>
{isVideoFormat && (
  <CreatePostVideoButton
    post={{ /* ... */ }}
    clientContext={clientContext}
    clientId={clientId}
  />
)}
```

**Step 3: TS check + commit**

```bash
npx tsc --noEmit 2>&1 | head -20
git add src/components/reports/CreateAdHocPost.tsx
git commit -m "feat(reports): pass clientContext through CreateAdHocPost"
```

---

### Task 1.6: Wire the new props in `ReportView`

**Files:**
- Modify: [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx)

**Step 1: Pass `clientContext` to `CalendarPostCard` and `CreateAdHocPost`**

Find the `<CalendarPostCard>` invocation at [`src/pages/ReportView.tsx:422-429`](src/pages/ReportView.tsx:422). Update the prop signature in `CalendarPostCard` (around line 540) to accept `clientContext: ClientContext` and pass it to both `<CreatePostDesignButton>` and `<CreatePostVideoButton>` (lines 721 and 727).

In the parent (the calendar map at line 421), pass `clientContext={clientContext}`.

Same for `<CreateAdHocPost>` at line 387: add `clientContext={clientContext}`.

**Step 2: TS check + commit**

```bash
npx tsc --noEmit 2>&1 | head -20
git add src/pages/ReportView.tsx
git commit -m "feat(reports): plumb clientContext from ReportView to button components"
```

---

### Task 1.7: Update `generate-post-image` edge function to accept and use `client_context`

**Files:**
- Modify: [`supabase/functions/generate-post-image/index.ts`](supabase/functions/generate-post-image/index.ts)

**Step 1: Update the body destructure** at line 31:

```ts
const {
  prompt,
  platform,
  format,
  brand_context,                  // legacy
  design_references,              // legacy
  brand_book_file_path,           // legacy
  client_context,                 // new — full structured context
  post,                           // new — post-level brief
} = await req.json();

// Backward compat: resolve from client_context if present, else legacy fields.
const resolvedBrand = client_context?.brand_identity ?? brand_context ?? null;
const resolvedRefs: string[] = client_context?.design_references ?? design_references ?? [];
const resolvedBrandBookPath: string | null =
  client_context?.brand_book_file_path ?? brand_book_file_path ?? null;
const resolvedSynthesis = client_context?.design_style_synthesis ?? null;
const resolvedPillars = client_context?.content_pillars ?? [];
const resolvedBriefText: string | null = client_context?.brief_text ?? null;
const resolvedBrandNotes: string | null = client_context?.brand_notes ?? null;
const resolvedLanguages: string[] = client_context?.languages ?? [];
const resolvedGeo: string[] = client_context?.geo ?? [];

console.log("[generate-post-image] context received:", {
  has_brand: !!resolvedBrand,
  ref_count: resolvedRefs.length,
  has_brand_book: !!resolvedBrandBookPath,
  has_synthesis: !!resolvedSynthesis,
  pillar_count: resolvedPillars.length,
  has_brief: !!resolvedBriefText,
});
```

**Step 2: Pass the brand book file as a multimodal part**

After the design references attachment block (currently lines 76-102), add a block to download and attach the brand book if a path was provided:

```ts
// Attach the brand book file as an inline part. Gemini 3.1 supports inline PDF/PNG/JPG.
if (resolvedBrandBookPath) {
  try {
    const storageClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: fileData } = await storageClient.storage
      .from("brand-books")
      .download(resolvedBrandBookPath);

    if (fileData) {
      const arrayBuffer = await fileData.arrayBuffer();
      if (arrayBuffer.byteLength <= 4 * 1024 * 1024) {
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const ext = resolvedBrandBookPath.split(".").pop()?.toLowerCase();
        const mimeType =
          ext === "pdf"
            ? "application/pdf"
            : ext === "png"
            ? "image/png"
            : "image/jpeg";
        contentParts.push({
          text: "Canonical brand book — defer to it on color, typography, and overall identity:",
        });
        contentParts.push({ inlineData: { mimeType, data: base64 } });
      } else {
        console.warn("[generate-post-image] brand book exceeds 4MB, skipping");
      }
    }
  } catch (e) {
    console.error("[generate-post-image] brand book attach failed:", e);
  }
}
```

**Step 3: Pass everything to `buildDesignPrompt`**

The prompt builder still gets a heavy rewrite in Phase 3. For now, change its signature to accept the resolved context object so this commit doesn't break behavior:

```ts
const designPrompt = buildDesignPrompt(
  prompt,
  platform,
  format,
  { ratio: aspectRatio, orientation },
  resolvedBrand,
  {
    synthesis: resolvedSynthesis,
    pillars: resolvedPillars,
    brief_text: resolvedBriefText,
    brand_notes: resolvedBrandNotes,
    languages: resolvedLanguages,
    geo: resolvedGeo,
    post,
  },
);
```

Update `buildDesignPrompt` signature at line 186 to accept the new arg (ignore it for now; Phase 3 uses it):

```ts
function buildDesignPrompt(
  basePrompt: string,
  platform?: string,
  format?: string,
  aspect?: { ratio: string; orientation: string },
  brand?: any,
  extras?: any,    // wired up in Phase 3
): string {
  // ... existing body unchanged for this commit
}
```

**Step 4: Push and verify in Supabase logs**

Push the branch, then trigger a single design generation from any test post in the live preview. In Lovable → Supabase → Functions → `generate-post-image` → Logs, confirm the `[generate-post-image] context received:` log shows non-zero/true for refs, brand book, pillars, brief as expected for the test client.

```bash
git add supabase/functions/generate-post-image/index.ts
git commit -m "feat(edge): accept client_context, attach brand book to Gemini call"
git push
```

---

### Task 1.8: Update `generate-post-video` to accept `client_context`

**Files:**
- Modify: [`supabase/functions/generate-post-video/index.ts`](supabase/functions/generate-post-video/index.ts)

**Step 1: Body destructure** at line 33:

```ts
const {
  prompt,
  platform,
  format,
  brandIdentity,              // legacy
  client_context,             // new
  post,                       // new
} = await req.json();

const resolvedBrand = client_context?.brand_identity ?? brandIdentity ?? null;
const resolvedRefs = client_context?.design_references ?? [];
const resolvedBrandBookPath = client_context?.brand_book_file_path ?? null;
const resolvedSynthesis = client_context?.design_style_synthesis ?? null;

console.log("[generate-post-video] context received:", {
  has_brand: !!resolvedBrand,
  ref_count: resolvedRefs.length,
  has_brand_book: !!resolvedBrandBookPath,
  has_synthesis: !!resolvedSynthesis,
});
```

**Step 2: Commit + push**

```bash
git add supabase/functions/generate-post-video/index.ts
git commit -m "feat(edge): accept client_context in generate-post-video"
git push
```

(The actual prompt rewrite happens in Phase 4. This commit just plumbs the data.)

---

### Phase 1 verification checkpoint

1. Open the Lovable preview, navigate to a report with a configured client (refs + brand book uploaded).
2. Click "Design" on any post → generate.
3. In Supabase function logs, confirm `[generate-post-image] context received:` shows the expected `ref_count > 0`, `has_brand_book: true`, `pillar_count > 0`, etc.
4. The output design quality won't have changed yet (prompt rewrite is Phase 3). Context plumbing is verified — the next phase improves what we do with that context.

---

## Phase 2 — Platform playbook (L3 part 1)

**Goal:** A maintainable data file with real per-platform/format design best-practices that gets injected into prompts.

### Task 2.1: Create the playbook data file

**Files:**
- Create: `supabase/functions/_shared/design-prompts/platformPlaybook.ts`

**Step 1: Write the file**

```ts
// supabase/functions/_shared/design-prompts/platformPlaybook.ts
// Per-platform/format design best-practices that get injected into generation
// prompts. Edit here to change guidance globally without redeploying edge
// functions individually.

export interface PlatformPlaybookEntry {
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "1.91:1";
  orientation: "square" | "portrait" | "vertical" | "horizontal";
  safeZones: string;                   // human description of safe zones
  scrollBehavior: string;              // how users encounter it
  firstFrameGuidance: string;          // what the first 1s/visible frame must do
  compositionGuidance: string;         // composition rules specific to this combo
  motionGuidance?: string;             // for video formats only
  textOverlayRules: string;            // when text overlays work, contrast rules
  avoid: string;                       // platform anti-patterns
}

type PlatformKey =
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "facebook"
  | "youtube"
  | "twitter"
  | "default";

type FormatKey =
  | "carousel"
  | "reel"
  | "story"
  | "single_image"
  | "video"
  | "short"
  | "article"
  | "document"
  | "default";

const PLAYBOOK: Record<PlatformKey, Partial<Record<FormatKey, PlatformPlaybookEntry>>> = {
  instagram: {
    carousel: {
      aspectRatio: "4:5",
      orientation: "portrait",
      safeZones:
        "Keep critical content within the central 80% — Instagram crops to 1:1 in some views. " +
        "Bottom-right corner has a small UI overlay (the dots indicator).",
      scrollBehavior:
        "Users see the cover slide in feed and swipe through. " +
        "The cover must reward the swipe; interior slides build on a single visual system.",
      firstFrameGuidance:
        "Cover slide carries the hook — a single bold headline or visual idea. " +
        "Treat it like a magazine cover, not a slide title.",
      compositionGuidance:
        "Strong hierarchy on the cover; interior slides have shared system " +
        "(common type scale, color usage, grid). Each slide a complete thought.",
      textOverlayRules:
        "Cover slide can be type-led. Interior slides: headline + supporting line max. " +
        "16-20px equivalent body type is the floor — readers are on phones.",
      avoid:
        "Cluttered covers with multiple competing focal points. Walls of body text. " +
        "Logos in centre. Anything resembling a stock template.",
    },
    reel: {
      aspectRatio: "9:16",
      orientation: "vertical",
      safeZones:
        "Bottom 35% has UI clutter: caption, like/comment/share buttons on the right edge, " +
        "audio attribution at bottom. Top ~10% has profile/avatar overlay. " +
        "Keep key content in the central 55% vertical band.",
      scrollBehavior:
        "Algorithmically served full-screen. 1.5 seconds to hook before scroll-past.",
      firstFrameGuidance:
        "First frame is a thumbnail — must be visually striking before motion. " +
        "Hook visual or person's face dominant.",
      compositionGuidance:
        "Subject fills the frame. Movement enters the frame from outside or via subject motion. " +
        "Avoid empty quadrants in the safe zone.",
      motionGuidance:
        "Smooth, cinematic. Hook beat in first 1.5s. Color grade consistent. " +
        "Avoid quick cuts in the first 2 seconds — they read as nervous, not energetic.",
      textOverlayRules:
        "Top half of safe zone if any. Heavy weight, high-contrast. " +
        "Stagger reveals — never reveal the whole sentence at once.",
      avoid: "Centered text in the bottom third (UI overlay). 16:9 letterboxing. Tiny type.",
    },
    story: {
      aspectRatio: "9:16",
      orientation: "vertical",
      safeZones:
        "Top 14% and bottom 20% have UI overlays (profile bar, reply input). " +
        "Keep content centered between them.",
      scrollBehavior:
        "Tap to advance, hold to pause, swipe to dismiss. ~5 seconds default.",
      firstFrameGuidance: "Hook in first 1 second; users tap through fast.",
      compositionGuidance:
        "Single bold visual. Strong contrast. One headline maximum. " +
        "Mood/atmosphere over information density.",
      textOverlayRules:
        "Centered safe zone only. Bold, large. Treat type like a chyron, not body copy.",
      avoid: "Information density. Text in the top 14% or bottom 20% UI zones.",
    },
    single_image: {
      aspectRatio: "4:5",
      orientation: "portrait",
      safeZones: "Avoid the bottom 15% — gets clipped in some grid previews.",
      scrollBehavior: "Static feed scroll. Less than 1 second of attention without a hook.",
      firstFrameGuidance: "Editorial-quality single frame. Magazine page energy.",
      compositionGuidance:
        "One subject, one focal point, breathing room. Type if used is a quiet companion to imagery.",
      textOverlayRules: "Sparse. Headline-only. Position based on imagery's negative space.",
      avoid: "Stock-template look. Three-bullet layouts. Decorative shapes for their own sake.",
    },
  },
  tiktok: {
    video: {
      aspectRatio: "9:16",
      orientation: "vertical",
      safeZones:
        "Right edge has profile/like/comment/share buttons (~12% width). " +
        "Bottom 25% has caption, audio, username. Top 15% has search/discover bar. " +
        "Central window for critical content is roughly 70% width, 60% height.",
      scrollBehavior:
        "Algorithmically served full-screen. 1 second to hook. Sound usually ON.",
      firstFrameGuidance:
        "Hook in first frame. Either a face, a clear visual setup, or text that creates curiosity. " +
        "Movement starts immediately.",
      compositionGuidance:
        "Subject-centered, vertical-native framing. Lo-fi/authentic feel over polish. " +
        "Polished-looking content can feel ad-like and underperforms.",
      motionGuidance:
        "Quick cuts OK from the start. Trend-driven pacing. " +
        "Camera movement can be handheld-feel. Hook beat clear.",
      textOverlayRules:
        "Top center safe zone only. Sans-serif, heavy weight, white with black outline for contrast. " +
        "Read-aloud short — assume captions also visible.",
      avoid:
        "16:9 letterboxing. Stock-music vibes. Overproduced corporate look. " +
        "Type in the right or bottom safe zones.",
    },
    short: {
      aspectRatio: "9:16",
      orientation: "vertical",
      safeZones: "Same as TikTok video.",
      scrollBehavior: "Same as TikTok video.",
      firstFrameGuidance: "Same as TikTok video.",
      compositionGuidance: "Same as TikTok video.",
      motionGuidance: "Same as TikTok video.",
      textOverlayRules: "Same as TikTok video.",
      avoid: "Same as TikTok video.",
    },
  },
  linkedin: {
    single_image: {
      aspectRatio: "1.91:1",
      orientation: "horizontal",
      safeZones:
        "If the post is shared from a link, the right 30% becomes a card stack — keep key content left-of-center.",
      scrollBehavior: "Feed scroll, often desktop. 2-3 seconds of attention possible.",
      firstFrameGuidance:
        "Editorial composition. Title-card or data-viz energy. Subdued, premium color treatment.",
      compositionGuidance:
        "Headline + one data point or single image. Generous whitespace. Sans-serif, refined.",
      textOverlayRules:
        "Headline overlay allowed. Conservative weight. Avoid stacks of bullets in image — put those in the caption.",
      avoid:
        "Loud colors. Stock business imagery (handshake, laptop+coffee). " +
        "Multiple competing CTAs.",
    },
    carousel: {
      aspectRatio: "1:1",
      orientation: "square",
      safeZones: "Center 90%. Bottom-right has 'X of Y' indicator.",
      scrollBehavior:
        "Desktop-heavy users. Swipe/click through. " +
        "First slide carries the hook; subsequent slides build a clear narrative.",
      firstFrameGuidance: "Magazine cover energy. Big idea + supporting line.",
      compositionGuidance:
        "Consistent type scale across slides. Whitespace generous. Subdued color story.",
      textOverlayRules:
        "Each slide one main idea + supporting line. Maximum 30-50 words per slide.",
      avoid: "Word walls. Random stock photos. Inconsistent slide layouts.",
    },
    video: {
      aspectRatio: "16:9",
      orientation: "horizontal",
      safeZones: "Bottom ~10% may have caption overlay. Otherwise full frame.",
      scrollBehavior: "Auto-plays muted. Captions ON by default for many users.",
      firstFrameGuidance:
        "Subject framing within first second. Avoid black opener — feed reads it as broken.",
      compositionGuidance: "Professional, restrained. Clear subject. Limited camera movement.",
      motionGuidance:
        "Smooth, deliberate. No quick cuts. Suitable pace for desktop viewing.",
      textOverlayRules: "Lower-third title overlay is standard. Keep captions readable.",
      avoid: "TikTok-style fast cuts. Underproduced look. Confusing transitions.",
    },
    article: {
      aspectRatio: "1.91:1",
      orientation: "horizontal",
      safeZones: "Center 80%. Title visible on hover/click.",
      scrollBehavior: "Title-card preview in feed. Click-through to read.",
      firstFrameGuidance: "Hero image for an article. Editorial photography or single-idea graphic.",
      compositionGuidance: "Article-header energy. Title may overlay if contrast allows.",
      textOverlayRules: "Optional title overlay, restrained.",
      avoid: "Generic stock business shots.",
    },
  },
  facebook: {
    video: {
      aspectRatio: "1:1",
      orientation: "square",
      safeZones: "Square format optimized for the feed. Avoid edge details.",
      scrollBehavior: "Auto-plays muted. Sound ON requires click.",
      firstFrameGuidance: "Visual storytelling that works silent. Captions essential.",
      compositionGuidance:
        "Bold subject. Strong color. Movement that reads without audio.",
      motionGuidance: "Clear cuts, telegraphed motion. Captions baked in or auto-gen-readable.",
      textOverlayRules:
        "Captions baked in (no UI captions on Facebook). " +
        "Position centered or top safe zone.",
      avoid: "Sound-dependent content. Long quiet openers.",
    },
    single_image: {
      aspectRatio: "1.91:1",
      orientation: "horizontal",
      safeZones: "Center 85%. Some feeds crop 1:1.",
      scrollBehavior: "Feed scroll.",
      firstFrameGuidance: "Bold subject, clear focal point.",
      compositionGuidance: "Single idea. Type-led or imagery-led but not both.",
      textOverlayRules: "Maximum 20% of pixels as text (legacy ad rule; still good practice).",
      avoid: "Heavy text overlays.",
    },
  },
  youtube: {
    short: {
      aspectRatio: "9:16",
      orientation: "vertical",
      safeZones:
        "Right edge ~12% has like/dislike/share/subscribe UI. " +
        "Bottom ~15% has title overlay and channel.",
      scrollBehavior: "Algorithmically served full-screen.",
      firstFrameGuidance: "Hook in first frame. Movement immediate.",
      compositionGuidance:
        "Subject-centered, vertical-native. Polished cinematic OK on YouTube " +
        "(unlike TikTok where overproduction hurts).",
      motionGuidance: "Cinematic camera moves. Dynamic lighting. Hook beat clear.",
      textOverlayRules: "Top safe zone. Heavy weight.",
      avoid: "Right-edge or bottom-15% type placement.",
    },
    video: {
      aspectRatio: "16:9",
      orientation: "horizontal",
      safeZones: "Bottom ~10% may have title/CC overlay.",
      scrollBehavior: "Click-through from thumbnails. High attention.",
      firstFrameGuidance:
        "Thumbnail-worthy first frame. Cinematic opening. Music/sound prominent.",
      compositionGuidance: "High production value. Dynamic. Cinematic lighting.",
      motionGuidance: "Cinematic camera movement. Smooth or stylized; intentional.",
      textOverlayRules: "Lower-third overlays standard. Title cards for transitions.",
      avoid: "Underproduced look. Static talking-head openers without context.",
    },
  },
  twitter: {
    single_image: {
      aspectRatio: "16:9",
      orientation: "horizontal",
      safeZones: "Center 90%. Image may crop 2:1 in feed.",
      scrollBehavior: "Feed scroll. Click expands.",
      firstFrameGuidance: "Quick-read concept. Headline + small image.",
      compositionGuidance: "Single idea. Strong contrast. Quick decode.",
      textOverlayRules: "Type-led OK. High contrast.",
      avoid: "Decorative shapes without purpose.",
    },
    video: {
      aspectRatio: "16:9",
      orientation: "horizontal",
      safeZones: "Center 90%.",
      scrollBehavior: "Auto-plays muted.",
      firstFrameGuidance: "Strong hook frame; sound-off readable.",
      compositionGuidance: "Quick decode. Bold subject.",
      motionGuidance: "Movement readable without sound.",
      textOverlayRules: "Captions baked in.",
      avoid: "Sound-dependent content.",
    },
  },
  default: {
    default: {
      aspectRatio: "1:1",
      orientation: "square",
      safeZones: "Keep critical content within central 85%.",
      scrollBehavior: "Feed scroll context.",
      firstFrameGuidance: "Strong hook frame.",
      compositionGuidance: "Single focal point. Strong hierarchy.",
      textOverlayRules: "Sparse, high contrast.",
      avoid: "Stock-template look.",
    },
  },
};

const PLATFORM_NORMALIZE: Record<string, PlatformKey> = {
  instagram: "instagram", ig: "instagram",
  tiktok: "tiktok", tt: "tiktok",
  linkedin: "linkedin", li: "linkedin",
  facebook: "facebook", fb: "facebook", meta: "facebook",
  youtube: "youtube", yt: "youtube",
  twitter: "twitter", x: "twitter",
};

const FORMAT_NORMALIZE: Array<[RegExp, FormatKey]> = [
  [/carousel|album|swipe|slideshow|gallery|multi-image/i, "carousel"],
  [/story|stories/i, "story"],
  [/reel/i, "reel"],
  [/short/i, "short"],
  [/article|document|pdf/i, "article"],
  [/video|clip/i, "video"],
  [/image|photo|single|static/i, "single_image"],
];

function normalizePlatform(p?: string): PlatformKey {
  if (!p) return "default";
  return PLATFORM_NORMALIZE[p.toLowerCase()] ?? "default";
}

function normalizeFormat(f?: string): FormatKey {
  if (!f) return "default";
  for (const [pattern, key] of FORMAT_NORMALIZE) {
    if (pattern.test(f)) return key;
  }
  return "default";
}

/**
 * Look up the playbook entry for a platform+format combo, with sensible
 * fallbacks. Always returns a valid entry.
 */
export function getPlaybookEntry(platform?: string, format?: string): PlatformPlaybookEntry {
  const platformKey = normalizePlatform(platform);
  const formatKey = normalizeFormat(format);
  const platformBook = PLAYBOOK[platformKey];
  const entry =
    platformBook?.[formatKey] ??
    platformBook?.["default"] ??
    PLAYBOOK.default!.default!;
  return entry;
}

/**
 * Render the playbook entry as a labelled markdown section for inclusion in a
 * generation prompt.
 */
export function renderPlaybookSection(entry: PlatformPlaybookEntry, platform?: string, format?: string): string {
  const lines = [
    `## Platform & format playbook — ${platform || "general"} ${format || ""}`.trim(),
    `Aspect: ${entry.aspectRatio} (${entry.orientation}).`,
    `Safe zones: ${entry.safeZones}`,
    `Scroll/encounter: ${entry.scrollBehavior}`,
    `First frame: ${entry.firstFrameGuidance}`,
    `Composition: ${entry.compositionGuidance}`,
  ];
  if (entry.motionGuidance) lines.push(`Motion: ${entry.motionGuidance}`);
  lines.push(`Text overlay rules: ${entry.textOverlayRules}`);
  lines.push(`Avoid: ${entry.avoid}`);
  return lines.join("\n");
}
```

**Step 2: Write tests**

Create `src/test/design-prompts/platformPlaybook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  getPlaybookEntry,
  renderPlaybookSection,
} from "../../../supabase/functions/_shared/design-prompts/platformPlaybook";

describe("platformPlaybook", () => {
  it("returns Reel entry for Instagram + Reel", () => {
    const entry = getPlaybookEntry("Instagram", "Reel/Video");
    expect(entry.aspectRatio).toBe("9:16");
    expect(entry.orientation).toBe("vertical");
    expect(entry.motionGuidance).toBeDefined();
  });

  it("returns TikTok video entry for TikTok + anything-video-like", () => {
    expect(getPlaybookEntry("TikTok", "Short Video").aspectRatio).toBe("9:16");
    expect(getPlaybookEntry("TikTok", "Reel").aspectRatio).toBe("9:16");
  });

  it("falls back to default for unknown platform", () => {
    const entry = getPlaybookEntry("MyTeenSocial", "Whatever");
    expect(entry).toBeDefined();
    expect(entry.aspectRatio).toBe("1:1");
  });

  it("normalizes platform aliases (ig, tt, fb)", () => {
    expect(getPlaybookEntry("ig", "carousel").aspectRatio).toBe("4:5");
    expect(getPlaybookEntry("tt", "video").aspectRatio).toBe("9:16");
    expect(getPlaybookEntry("fb", "single image").aspectRatio).toBe("1.91:1");
  });

  it("renders a markdown section with the platform name", () => {
    const entry = getPlaybookEntry("LinkedIn", "Single Image");
    const md = renderPlaybookSection(entry, "LinkedIn", "Single Image");
    expect(md).toContain("LinkedIn");
    expect(md).toContain("Aspect: 1.91:1");
    expect(md).toContain("Avoid:");
  });
});
```

**Step 3: Run the tests**

```bash
cd /tmp/moburst-socialytics-ai && npx vitest run src/test/design-prompts/platformPlaybook.test.ts
```

Expected: 5 passing tests.

**Step 4: Commit**

```bash
git add supabase/functions/_shared/design-prompts/platformPlaybook.ts src/test/design-prompts/platformPlaybook.test.ts
git commit -m "feat(prompts): add platform/format design playbook with tests"
```

---

## Phase 3 — Image prompt builder (L3 part 2)

**Goal:** A clean, layered prompt builder that uses synthesis as primary brief, eliminates hex codes from prompt text, and injects platform playbook.

### Task 3.1: Create the synthesis flattener

**Files:**
- Create: `supabase/functions/_shared/design-prompts/flattenSynthesis.ts`
- Create: `src/test/design-prompts/flattenSynthesis.test.ts`

**Step 1: Write the module**

```ts
// supabase/functions/_shared/design-prompts/flattenSynthesis.ts

export interface DesignStyleSynthesis {
  composition_patterns?: string;
  typography_treatment?: string;
  imagery_style?: string;
  color_usage?: string;
  surface_and_texture?: string;
  logo_and_marks_treatment?: string;
  mood_and_voice_visual?: string;
  anti_patterns?: string;
  platform_adaptations?: string;
  synthesized_at?: string;
  source_count?: number;
}

const SECTION_LABELS: Array<[keyof DesignStyleSynthesis, string]> = [
  ["composition_patterns", "Composition"],
  ["typography_treatment", "Typography"],
  ["imagery_style", "Imagery"],
  ["color_usage", "Color usage"],
  ["surface_and_texture", "Surface & texture"],
  ["logo_and_marks_treatment", "Logo & marks"],
  ["mood_and_voice_visual", "Mood"],
  ["platform_adaptations", "Platform adaptations"],
  ["anti_patterns", "Anti-patterns (avoid)"],
];

/**
 * Render the synthesis JSON object as a labelled markdown section for prompt
 * injection. Skips empty fields. Returns an empty string if no synthesis is
 * present so callers can decide whether to fall back.
 */
export function flattenSynthesis(s: DesignStyleSynthesis | null | undefined): string {
  if (!s) return "";
  const sections: string[] = [];
  for (const [key, label] of SECTION_LABELS) {
    const value = s[key];
    if (typeof value === "string" && value.trim().length > 0) {
      sections.push(`### ${label}\n${value.trim()}`);
    }
  }
  if (sections.length === 0) return "";
  return [`## Brand design language\n`, ...sections].join("\n\n");
}
```

**Step 2: Write the tests**

```ts
// src/test/design-prompts/flattenSynthesis.test.ts
import { describe, it, expect } from "vitest";
import { flattenSynthesis } from "../../../supabase/functions/_shared/design-prompts/flattenSynthesis";

describe("flattenSynthesis", () => {
  it("returns empty string for null/undefined", () => {
    expect(flattenSynthesis(null)).toBe("");
    expect(flattenSynthesis(undefined)).toBe("");
  });

  it("returns empty string when all fields are missing", () => {
    expect(flattenSynthesis({})).toBe("");
  });

  it("includes labels and content for populated fields", () => {
    const md = flattenSynthesis({
      composition_patterns: "Asymmetric, generous breathing room",
      anti_patterns: "Centered stock photography",
    });
    expect(md).toContain("## Brand design language");
    expect(md).toContain("### Composition");
    expect(md).toContain("Asymmetric, generous breathing room");
    expect(md).toContain("### Anti-patterns (avoid)");
    expect(md).toContain("Centered stock photography");
  });

  it("skips empty-string fields", () => {
    const md = flattenSynthesis({
      composition_patterns: "",
      typography_treatment: "Serif display + sans body",
    });
    expect(md).not.toContain("### Composition");
    expect(md).toContain("### Typography");
  });
});
```

**Step 3: Run tests + commit**

```bash
npx vitest run src/test/design-prompts/flattenSynthesis.test.ts
git add supabase/functions/_shared/design-prompts/flattenSynthesis.ts src/test/design-prompts/flattenSynthesis.test.ts
git commit -m "feat(prompts): add synthesis flattener with tests"
```

---

### Task 3.2: Create the image prompt builder

**Files:**
- Create: `supabase/functions/_shared/design-prompts/buildImagePrompt.ts`
- Create: `src/test/design-prompts/buildImagePrompt.test.ts`

**Step 1: Write the builder**

```ts
// supabase/functions/_shared/design-prompts/buildImagePrompt.ts

import { flattenSynthesis, type DesignStyleSynthesis } from "./flattenSynthesis.ts";
import {
  getPlaybookEntry,
  renderPlaybookSection,
} from "./platformPlaybook.ts";

export interface BuildImagePromptInput {
  // Required
  basePrompt: string;          // creative direction (post-specific)
  platform?: string;
  format?: string;
  // Optional
  brandIdentity?: any;          // colors etc — used only for fallback when synthesis absent
  synthesis?: DesignStyleSynthesis | null;
  pillars?: Array<{ name: string; description: string }>;
  briefText?: string | null;
  brandNotes?: string | null;
  languages?: string[];
  geo?: string[];
  post?: {
    pillar?: string;
    language?: string;
    visual_direction?: string;
    copy?: string;
  };
  variantAngle?: string | null; // Phase 6
  slideContext?: {              // for carousels
    index: number;
    total: number;
  };
}

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;

function stripHex(text: string): string {
  return text.replace(HEX_RE, "the brand color");
}

/**
 * Compose a clean, layered prompt for Gemini 3.1 Flash Image. The order
 * matters — LLMs weight early tokens heavier — so the post-specific creative
 * direction leads, followed by the brand design language, then the platform
 * playbook, then a thin constraints block.
 *
 * No hex codes appear anywhere in the returned string. Colors are described
 * qualitatively via the synthesis. The base prompt is sanitized of any hex
 * codes it may contain.
 */
export function buildImagePrompt(input: BuildImagePromptInput): string {
  const sections: string[] = [];

  // 1. Creative direction (post-specific)
  const sanitizedBase = stripHex(input.basePrompt);
  const pillarLabel = input.post?.pillar ? `\nContent pillar: ${input.post.pillar}` : "";
  const langLabel = input.post?.language ? `\nLanguage of any visible text: ${input.post.language}` : "";
  sections.push(
    `## Creative direction\n` +
      `${sanitizedBase}${pillarLabel}${langLabel}\n\n` +
      `This is a complete, ready-to-post social media image — not a placeholder, abstract background, ` +
      `or generic stock. Treat it like work a senior social media designer would ship.`,
  );

  // 2. Brand design language (synthesis if present, else brand identity fallback)
  const synthesisMd = flattenSynthesis(input.synthesis);
  if (synthesisMd) {
    sections.push(synthesisMd);
  } else if (input.brandIdentity) {
    // Fallback when no synthesis exists yet: use brand_identity qualitative fields.
    const fallback: string[] = ["## Brand design language"];
    if (input.brandIdentity.visual_style) {
      fallback.push(`### Visual style\n${input.brandIdentity.visual_style}`);
    }
    if (input.brandIdentity.design_elements) {
      fallback.push(`### Design elements\n${input.brandIdentity.design_elements}`);
    }
    if (input.brandIdentity.background_style) {
      fallback.push(`### Background\n${input.brandIdentity.background_style}`);
    }
    if (input.brandIdentity.tone_of_voice) {
      fallback.push(`### Tone\n${input.brandIdentity.tone_of_voice}`);
    }
    if (input.brandIdentity.font_family) {
      fallback.push(`### Typography\nPrefer ${input.brandIdentity.font_family}-style typography or a close-feel sans alternative.`);
    }
    if (fallback.length > 1) sections.push(fallback.join("\n\n"));
  }

  // 3. Platform & format playbook
  const playbook = getPlaybookEntry(input.platform, input.format);
  sections.push(renderPlaybookSection(playbook, input.platform, input.format));

  // 4. Composition checklist (carousel context, if any)
  if (input.slideContext) {
    const { index, total } = input.slideContext;
    if (index === 0) {
      sections.push(
        `## Slide context\nThis is slide 1 of ${total} (cover/hook). ` +
          `Carry the strongest visual idea — interior slides build on this system.`,
      );
    } else {
      sections.push(
        `## Slide context\nThis is slide ${index + 1} of ${total}. ` +
          `Maintain the cover's type scale, color story, and grid. Each interior slide is one clear idea.`,
      );
    }
  }

  // 5. Underlying palette (qualitative only — NO hex codes)
  sections.push(
    `## Underlying palette\n` +
      `Use the brand's primary, secondary, and accent colors as established in the design language above. ` +
      `Apply them per the composition patterns and color usage rules. White and neutral darks are fine for contrast.`,
  );

  // 6. Variant angle (Phase 6 will populate this)
  if (input.variantAngle && input.variantAngle.trim()) {
    sections.push(`## Variant angle\n${input.variantAngle.trim()}`);
  }

  // 7. Hard constraints (short, qualitative)
  sections.push(
    `## Constraints\n` +
      `- No company logos, brand wordmarks, or watermarks — the client adds those later.\n` +
      `- No invented company names or brand text — only use text that appears in the creative direction.\n` +
      `- No hex color codes, RGB values, or any technical color notation visible as text in the image.\n` +
      `- No stock-photo cliché or template-generator look.`,
  );

  return sections.join("\n\n");
}
```

**Step 2: Write tests**

```ts
// src/test/design-prompts/buildImagePrompt.test.ts
import { describe, it, expect } from "vitest";
import { buildImagePrompt } from "../../../supabase/functions/_shared/design-prompts/buildImagePrompt";

describe("buildImagePrompt", () => {
  it("never includes hex codes in the output", () => {
    const out = buildImagePrompt({
      basePrompt: "A poster about #FF5733 brand colors",
      platform: "Instagram",
      format: "Single Image",
      brandIdentity: { primary_color: "#FF5733", secondary_color: "#1A73E8" },
    });
    expect(out).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(out.toLowerCase()).toContain("the brand color");
  });

  it("uses the synthesis as primary brand language when available", () => {
    const out = buildImagePrompt({
      basePrompt: "A launch announcement",
      platform: "LinkedIn",
      format: "Single Image",
      synthesis: {
        composition_patterns: "Generous whitespace, asymmetric balance",
        imagery_style: "Editorial photography, restrained palette",
      },
    });
    expect(out).toContain("## Brand design language");
    expect(out).toContain("### Composition");
    expect(out).toContain("Generous whitespace");
  });

  it("falls back to brand identity fields when no synthesis present", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      brandIdentity: {
        visual_style: "Bold, energetic, slightly retro",
        tone_of_voice: "Confident",
      },
    });
    expect(out).toContain("### Visual style");
    expect(out).toContain("Bold, energetic, slightly retro");
  });

  it("includes the platform playbook for the given combo", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      platform: "Instagram",
      format: "Reel",
    });
    expect(out).toContain("## Platform & format playbook");
    expect(out).toContain("9:16");
  });

  it("includes carousel cover/interior context when slideContext present", () => {
    const cover = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 0, total: 5 },
    });
    expect(cover).toContain("slide 1 of 5");
    expect(cover.toLowerCase()).toContain("cover");

    const interior = buildImagePrompt({
      basePrompt: "x",
      slideContext: { index: 2, total: 5 },
    });
    expect(interior).toContain("slide 3 of 5");
  });

  it("includes the variant angle when provided", () => {
    const out = buildImagePrompt({
      basePrompt: "x",
      variantAngle: "Type-led: text dominates, imagery is secondary",
    });
    expect(out).toContain("## Variant angle");
    expect(out).toContain("Type-led");
  });

  it("places the creative direction before the brand language", () => {
    const out = buildImagePrompt({
      basePrompt: "The post brief",
      synthesis: { composition_patterns: "Asymmetric" },
    });
    const creativeIdx = out.indexOf("Creative direction");
    const brandIdx = out.indexOf("Brand design language");
    expect(creativeIdx).toBeGreaterThanOrEqual(0);
    expect(brandIdx).toBeGreaterThan(creativeIdx);
  });
});
```

**Step 3: Run tests + commit**

```bash
npx vitest run src/test/design-prompts/buildImagePrompt.test.ts
git add supabase/functions/_shared/design-prompts/buildImagePrompt.ts src/test/design-prompts/buildImagePrompt.test.ts
git commit -m "feat(prompts): add layered image prompt builder with no hex codes in text"
```

---

### Task 3.3: Swap `generate-post-image` to the new builder

**Files:**
- Modify: [`supabase/functions/generate-post-image/index.ts`](supabase/functions/generate-post-image/index.ts)

**Step 1: Add the import at the top of the file**

```ts
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";
```

**Step 2: Replace the call to the legacy `buildDesignPrompt`** (the one we wired-but-didn't-use in Task 1.7). Replace with:

```ts
const designPrompt = buildImagePrompt({
  basePrompt: prompt,
  platform,
  format,
  brandIdentity: resolvedBrand,
  synthesis: resolvedSynthesis,
  pillars: resolvedPillars,
  briefText: resolvedBriefText,
  brandNotes: resolvedBrandNotes,
  languages: resolvedLanguages,
  geo: resolvedGeo,
  post,
  // variantAngle filled in Phase 6
  // slideContext filled by callers for carousels — see step 3
});
```

**Step 3: Wire `slideContext` from caller**

In the same body destructure, accept `slide_context`:

```ts
const { /* existing fields */, slide_context } = await req.json();
```

And pass `slideContext: slide_context` into `buildImagePrompt`.

Update the caller in [`src/components/reports/CreatePostDesignButton.tsx`](src/components/reports/CreatePostDesignButton.tsx) — in the carousel slide loop, instead of inlining slide context into the prompt string ([line 105-107](src/components/reports/CreatePostDesignButton.tsx:105)), pass it as a separate field:

```ts
const { data, error } = await supabase.functions.invoke("generate-post-image", {
  body: {
    prompt: designPrompt,
    platform: post.platform,
    format: post.format,
    brand_context: effectiveBrandIdentity || undefined,
    design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
    brand_book_file_path: effectiveBrandBookFilePath || undefined,
    client_context: clientContext || undefined,
    post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
    slide_context: count > 1 ? { index: i, total: count } : undefined,
  },
});
```

Remove the old inline slide-context concatenation.

**Step 4: Delete the legacy `buildDesignPrompt` function** at [`supabase/functions/generate-post-image/index.ts:180-261`](supabase/functions/generate-post-image/index.ts:180). Replace it with nothing (the new builder is imported).

**Step 5: Commit and push**

```bash
git add supabase/functions/generate-post-image/index.ts src/components/reports/CreatePostDesignButton.tsx
git commit -m "feat(edge): generate-post-image uses new layered prompt builder"
git push
```

**Step 6: Manual verification in Lovable preview**

1. Open a test report, click Design on a single-image post → Generate.
2. In Supabase logs, expand the most recent `generate-post-image` invocation and find the request payload. Confirm the prompt string contains `## Creative direction`, `## Brand design language` (or fallback), `## Platform & format playbook`, no `#XXXXXX` hex codes.
3. Compare the generated image visually with one from the old prompt (regenerate the same post on `main`).
4. Repeat for a 3-slide carousel — confirm slide 1 prompt contains "cover" and slide 3 contains "slide 3 of 3".

---

## Phase 4 — Video prompt builder (L3 part 3)

### Task 4.1: Create the video prompt builder

**Files:**
- Create: `supabase/functions/_shared/design-prompts/buildVideoPrompt.ts`
- Create: `src/test/design-prompts/buildVideoPrompt.test.ts`

**Step 1: Write the builder**

```ts
// supabase/functions/_shared/design-prompts/buildVideoPrompt.ts

import { flattenSynthesis, type DesignStyleSynthesis } from "./flattenSynthesis.ts";
import {
  getPlaybookEntry,
  renderPlaybookSection,
} from "./platformPlaybook.ts";

export interface BuildVideoPromptInput {
  sceneDescription: string;   // already-distilled Veo-style single-shot description
  platform?: string;
  format?: string;
  brandIdentity?: any;
  synthesis?: DesignStyleSynthesis | null;
  post?: { pillar?: string; visual_direction?: string; copy?: string };
  variantAngle?: string | null;
}

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;

function stripHex(text: string): string {
  return text.replace(HEX_RE, "the brand color");
}

export function buildVideoPrompt(input: BuildVideoPromptInput): string {
  const sections: string[] = [];

  // 1. The single-shot scene description (Veo wants ≤3 sentences here)
  sections.push(stripHex(input.sceneDescription).trim());

  // 2. Brand design language (synthesis or fallback)
  const synthesisMd = flattenSynthesis(input.synthesis);
  if (synthesisMd) {
    sections.push(synthesisMd);
  } else if (input.brandIdentity) {
    const lines: string[] = [];
    if (input.brandIdentity.visual_style) lines.push(`Visual style: ${input.brandIdentity.visual_style}`);
    if (input.brandIdentity.tone_of_voice) lines.push(`Tone: ${input.brandIdentity.tone_of_voice}`);
    if (input.brandIdentity.background_style) lines.push(`Environment: ${input.brandIdentity.background_style}`);
    if (input.brandIdentity.design_elements) lines.push(`Design language: ${input.brandIdentity.design_elements}`);
    if (lines.length > 0) sections.push(lines.join(". ") + ".");
  }

  // 3. Platform playbook (motion guidance especially)
  const playbook = getPlaybookEntry(input.platform, input.format);
  sections.push(renderPlaybookSection(playbook, input.platform, input.format));

  // 4. Variant angle
  if (input.variantAngle && input.variantAngle.trim()) {
    sections.push(`Variant angle: ${input.variantAngle.trim()}`);
  }

  // 5. Hard constraints
  sections.push(
    "Constraints: No text overlays, watermarks, logos, or color codes visible in any frame. " +
      "No real people's names or celebrity likenesses. " +
      "Describe colors only through the visual look, never as written codes.",
  );

  return sections.join("\n\n");
}
```

**Step 2: Tests**

```ts
// src/test/design-prompts/buildVideoPrompt.test.ts
import { describe, it, expect } from "vitest";
import { buildVideoPrompt } from "../../../supabase/functions/_shared/design-prompts/buildVideoPrompt";

describe("buildVideoPrompt", () => {
  it("strips hex codes from the scene description", () => {
    const out = buildVideoPrompt({
      sceneDescription: "A close-up product shot in #FF5733 light",
    });
    expect(out).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(out).toContain("the brand color");
  });

  it("includes motion guidance from the playbook for video formats", () => {
    const out = buildVideoPrompt({
      sceneDescription: "x",
      platform: "TikTok",
      format: "Video",
    });
    expect(out).toContain("Motion:");
  });

  it("uses synthesis as primary brand language", () => {
    const out = buildVideoPrompt({
      sceneDescription: "x",
      synthesis: { mood_and_voice_visual: "Restrained, deliberate, premium" },
    });
    expect(out).toContain("### Mood");
    expect(out).toContain("Restrained");
  });
});
```

**Step 3: Run + commit**

```bash
npx vitest run src/test/design-prompts/buildVideoPrompt.test.ts
git add supabase/functions/_shared/design-prompts/buildVideoPrompt.ts src/test/design-prompts/buildVideoPrompt.test.ts
git commit -m "feat(prompts): add layered video prompt builder"
```

---

### Task 4.2: Update `adapt-creative-prompt` to receive full context

**Files:**
- Modify: [`supabase/functions/adapt-creative-prompt/index.ts`](supabase/functions/adapt-creative-prompt/index.ts)

**Step 1: Extend the request body** at line 20:

```ts
const {
  concept,
  visual_direction,
  original_format,
  target_format,
  platform,
  client_context,
} = await req.json();
```

**Step 2: Build a context preamble for the Claude call**

After the body destructure, add:

```ts
const synthesisJson = client_context?.design_style_synthesis
  ? JSON.stringify(client_context.design_style_synthesis)
  : "";
const brandContextPreamble = synthesisJson
  ? `\n\nClient brand design language (JSON):\n${synthesisJson}\n\nDistill the scene in a way that fits this design language.`
  : "";
```

**Step 3: Add the preamble inside the `systemPrompt` template literals** (both Veo and non-Veo branches). For the Veo branch, after the existing `Platform: ${platform || "general"}` line, insert `${brandContextPreamble}`. Same for the non-Veo branch.

**Step 4: Commit + push**

```bash
git add supabase/functions/adapt-creative-prompt/index.ts
git commit -m "feat(edge): adapt-creative-prompt receives client_context for distillation"
git push
```

---

### Task 4.3: Wire the new video builder into `generate-post-video`

**Files:**
- Modify: [`supabase/functions/generate-post-video/index.ts`](supabase/functions/generate-post-video/index.ts)

**Step 1: Add the import**

```ts
import { buildVideoPrompt } from "../_shared/design-prompts/buildVideoPrompt.ts";
```

**Step 2: Build the enhanced prompt before sending to Veo**

The current code uses the user-supplied `prompt` directly. Replace that with a build step. After the body destructure / `resolvedXxx` block from Task 1.8, insert:

```ts
const enhancedPrompt = buildVideoPrompt({
  sceneDescription: prompt,
  platform,
  format,
  brandIdentity: resolvedBrand,
  synthesis: resolvedSynthesis,
  post,
  // variantAngle filled in Phase 7
});
```

Then in the Veo request body, use `enhancedPrompt` instead of `prompt`:

```ts
body: JSON.stringify({
  instances: [{ prompt: enhancedPrompt }],
  parameters: { /* unchanged */ },
})
```

**Step 3: Update the client-side `buildVideoPrompt` in `CreatePostVideoButton.tsx`**

The client currently builds its own prompt by concatenating brand notes etc. ([`src/components/reports/CreatePostVideoButton.tsx:93-122`](src/components/reports/CreatePostVideoButton.tsx:93)). Now that the edge function builds the full prompt, the client should pass only the **distilled scene description** as `prompt`. Remove the client-side concatenation of brand colors / visual style / platform style / constraints — those happen in the edge function now.

Replace the client-side `buildVideoPrompt` function body with:

```ts
const buildVideoPrompt = (sceneDescription: string) => sceneDescription;
```

(Or remove the function and pass `sceneDescription` directly.) Keep the `distillForVeo` call.

**Step 4: Commit + push**

```bash
git add supabase/functions/generate-post-video/index.ts src/components/reports/CreatePostVideoButton.tsx
git commit -m "feat(video): edge function builds full Veo prompt from context"
git push
```

**Step 5: Manual verification**

1. Open a test report, click Video on a Reel-format post → Generate.
2. In Supabase logs, find the `generate-post-video` invocation; the `instances[0].prompt` should be a multi-section structured string with playbook, design language, etc.
3. Watch the generated video. Compare against an old generation.

---

## Phase 5 — Synthesis edge function + UI (L2)

**Goal:** Pre-compute a structured 9-field design language from design refs + brand book once per client, store in `clients.design_style_synthesis`, surface in onboarding.

### Task 5.1: Create the `synthesize-design-language` edge function

**Files:**
- Create: `supabase/functions/synthesize-design-language/index.ts`

**Step 1: Write the function**

```ts
// supabase/functions/synthesize-design-language/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are a senior brand designer doing a forensic style analysis.

You receive a set of reference images and (optionally) a brand book document from a single client. Your job is to write a structured "design language" descriptor that another designer (or generative image model) could use to produce new on-brand work.

OUTPUT FORMAT: A single JSON object with these fields, all strings (1-4 sentences each):

{
  "composition_patterns": "...",
  "typography_treatment": "...",
  "imagery_style": "...",
  "color_usage": "...",
  "surface_and_texture": "...",
  "logo_and_marks_treatment": "...",
  "mood_and_voice_visual": "...",
  "anti_patterns": "...",
  "platform_adaptations": "..."
}

RULES:
- Describe colors qualitatively only — never use hex codes, RGB values, or any technical color notation. Example: "warm coral as accent in roughly 10-15% of compositions, against a deep navy ground" (good); "#FF5733 accent on #1A2B3C" (forbidden).
- Each field is concrete and actionable. Avoid "Sometimes uses bold colors" — prefer "Bold color blocks at ~30% of the composition, anchored bottom-left in 60% of references."
- anti_patterns lists 2-4 things to NOT do (gleaned from what's absent or contradicted in the refs).
- platform_adaptations describes how the style translates across IG/LinkedIn/TikTok/etc.
- Return ONLY the JSON object, no preamble, no markdown fence.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: "client_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Resolve Anthropic key
    let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "anthropic_api_key")
        .maybeSingle();
      anthropicKey = setting?.value;
    }
    if (!anthropicKey) return json({ error: "Anthropic key not configured" }, 400);

    // Load the client
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("name, design_references, brand_book_file_path")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "client not found" }, 404);

    const designRefs: string[] = Array.isArray(client.design_references)
      ? (client.design_references as string[])
      : [];
    const brandBookPath: string | null = client.brand_book_file_path || null;

    if (designRefs.length === 0 && !brandBookPath) {
      return json({ error: "No design references or brand book uploaded" }, 400);
    }

    // Build the Claude vision request — up to 8 refs + brand book
    const content: any[] = [
      {
        type: "text",
        text: `Analyze these brand references for "${client.name}" and produce the JSON design-language descriptor.`,
      },
    ];

    let sourceCount = 0;

    for (const refPath of designRefs.slice(0, 8)) {
      try {
        const { data: file } = await supabase.storage.from("design-references").download(refPath);
        if (!file) continue;
        const ab = await file.arrayBuffer();
        if (ab.byteLength > 4 * 1024 * 1024) continue;
        const bytes = new Uint8Array(ab);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const ext = refPath.split(".").pop()?.toLowerCase();
        const mt = ext === "png" ? "image/png" : "image/jpeg";
        content.push({ type: "image", source: { type: "base64", media_type: mt, data: b64 } });
        sourceCount++;
      } catch (e) {
        console.warn("[synthesize] skipping ref", refPath, e);
      }
    }

    if (brandBookPath) {
      try {
        const { data: file } = await supabase.storage.from("brand-books").download(brandBookPath);
        if (file) {
          const ab = await file.arrayBuffer();
          if (ab.byteLength <= 4 * 1024 * 1024) {
            const bytes = new Uint8Array(ab);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const b64 = btoa(bin);
            const ext = brandBookPath.split(".").pop()?.toLowerCase();
            const mt =
              ext === "pdf"
                ? "application/pdf"
                : ext === "png"
                ? "image/png"
                : "image/jpeg";
            // Claude supports image and document types
            if (mt === "application/pdf") {
              content.push({ type: "document", source: { type: "base64", media_type: mt, data: b64 } });
            } else {
              content.push({ type: "image", source: { type: "base64", media_type: mt, data: b64 } });
            }
            sourceCount++;
          }
        }
      } catch (e) {
        console.warn("[synthesize] skipping brand book", e);
      }
    }

    if (sourceCount === 0) {
      return json({ error: "Could not load any references" }, 500);
    }

    console.log("[synthesize] calling Claude with", sourceCount, "sources");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error("[synthesize] Anthropic error:", resp.status, body);
      return json({ error: "synthesis failed", details: body }, 502);
    }

    const result = await resp.json();
    const text = result.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ error: "could not parse JSON from Claude output" }, 500);

    let synthesis: any;
    try {
      synthesis = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return json({ error: "JSON parse error", details: String(e) }, 500);
    }

    synthesis.synthesized_at = new Date().toISOString();
    synthesis.source_count = sourceCount;

    // Persist
    const { error: updateErr } = await supabase
      .from("clients")
      .update({ design_style_synthesis: synthesis })
      .eq("id", client_id);

    if (updateErr) return json({ error: "DB update failed", details: updateErr.message }, 500);

    return json({ design_style_synthesis: synthesis });
  } catch (e: any) {
    console.error("[synthesize] unexpected error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});
```

**Step 2: Commit + push**

```bash
git add supabase/functions/synthesize-design-language/index.ts
git commit -m "feat(edge): add synthesize-design-language function"
git push
```

---

### Task 5.2: Add the synthesis card to onboarding UI

**Files:**
- Create: `src/components/onboarding/DesignSynthesisCard.tsx`
- Modify: [`src/pages/ClientSetup.tsx`](src/pages/ClientSetup.tsx)

**Step 1: Build the card component**

```tsx
// src/components/onboarding/DesignSynthesisCard.tsx
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  clientId?: string;
  designReferencesCount: number;
  hasBrandBook: boolean;
  existingSynthesis: any | null;
  onSynthesized: (s: any) => void;
  /**
   * If true, schedules a debounced auto-trigger when inputs change.
   * Default true. Pass false from forms that aren't saved yet (e.g., new client).
   */
  autoTrigger?: boolean;
}

export function DesignSynthesisCard({
  clientId,
  designReferencesCount,
  hasBrandBook,
  existingSynthesis,
  onSynthesized,
  autoTrigger = true,
}: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const hasInputs = designReferencesCount > 0 || hasBrandBook;
  const synthesizedAt = existingSynthesis?.synthesized_at
    ? new Date(existingSynthesis.synthesized_at)
    : null;
  const sourceCount = existingSynthesis?.source_count ?? 0;

  const run = async () => {
    if (!clientId) {
      toast.error("Save the client first, then synthesize.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-design-language", {
        body: { client_id: clientId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.design_style_synthesis) {
        onSynthesized(data.design_style_synthesis);
        toast.success("Design language synthesized");
      }
    } catch (e: any) {
      setError(e.message || String(e));
      toast.error("Synthesis failed");
    } finally {
      setRunning(false);
    }
  };

  // Debounced auto-trigger when inputs change
  useEffect(() => {
    if (!autoTrigger || !clientId || !hasInputs) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      run();
    }, 10_000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // We want to fire when ref count or brand book changes — clientId stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designReferencesCount, hasBrandBook, clientId, autoTrigger]);

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Brand design language
          </Label>
          <Button
            variant="outline"
            size="sm"
            disabled={running || !hasInputs || !clientId}
            onClick={run}
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            {existingSynthesis ? "Re-run" : "Synthesize"}
          </Button>
        </div>

        {!hasInputs && (
          <p className="text-xs text-muted-foreground">
            Upload design references or a brand book above, then synthesize. The result is used to guide every generated design.
          </p>
        )}

        {hasInputs && !existingSynthesis && !running && !error && (
          <p className="text-xs text-muted-foreground">
            No synthesis yet. Auto-runs ~10s after upload, or click Synthesize.
          </p>
        )}

        {running && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Synthesizing brand design language…
          </p>
        )}

        {error && !running && (
          <div className="text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-3 w-3" /> Synthesis failed — re-run. ({error})
          </div>
        )}

        {existingSynthesis && !running && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-success" />
            Synthesized {synthesizedAt ? synthesizedAt.toLocaleString() : "(unknown)"} from {sourceCount} sources.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Wire into ClientSetup**

In [`src/pages/ClientSetup.tsx`](src/pages/ClientSetup.tsx), at the Brief tab section, right after the existing `<DesignReferencesUpload>`, add:

```tsx
<DesignSynthesisCard
  clientId={id !== "new" ? id : undefined}
  designReferencesCount={form.design_references.length}
  hasBrandBook={!!form.brand_book_file_path}
  existingSynthesis={form.brand_identity?.design_style_synthesis || form.design_style_synthesis || null}
  onSynthesized={(s) => setForm((f) => ({ ...f, design_style_synthesis: s }))}
/>
```

Add the import. Also add `design_style_synthesis: null as any` to the initial `form` state and to the `client →form` mapping in the `useEffect` at line 135.

Persist it: the existing save mutation already does `update payload` — confirm `design_style_synthesis` is in the payload destructure (or just let Postgres ignore unknown columns). Make sure NOT to wipe it on save when the form value matches the synthesis already stored.

**Step 3: Commit + push**

```bash
git add src/components/onboarding/DesignSynthesisCard.tsx src/pages/ClientSetup.tsx
git commit -m "feat(onboarding): synthesis card with debounced auto-trigger"
git push
```

---

### Task 5.3: Manual verification

1. Open Lovable preview, navigate to an existing test client's setup page.
2. Confirm design refs are uploaded (or upload some).
3. Wait ~10s after upload — synthesis should auto-fire. Or click Synthesize.
4. In ~30-60s, "Synthesized just now from N sources" appears.
5. Query Supabase: `select design_style_synthesis from clients where id = '<id>';` — confirm the 9-section JSON.
6. Generate a design from a report — Supabase log shows the new structured prompt containing the synthesis sections.

---

## Phase 6 — Multi-variant images (L4 part 1)

### Task 6.1: Create `propose-design-angles` edge function

**Files:**
- Create: `supabase/functions/propose-design-angles/index.ts`

**Step 1: Write it**

```ts
// supabase/functions/propose-design-angles/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are a creative director generating angle variants for a single social media design brief.

You receive a brief (the post idea + visual direction + platform). Your job is to propose 6 distinct creative angles that the same brief could be executed through. Each angle should produce a meaningfully different design — not just a different seed.

Examples of good angle dimensions:
- Type-led vs photo-led vs illustration-led
- Asymmetric vs centered composition
- Day-mood vs night-mood
- Quiet/restrained vs loud/expressive
- Editorial-photographic vs graphic-poster
- Macro/close vs wide/contextual
- Bold-color-blocks vs subtle-gradient ground

OUTPUT: Return ONLY a JSON object of this shape, no preamble:
{
  "angles": [
    { "label": "Type-led", "instruction": "Treat the headline as the hero…" },
    ...6 entries total
  ]
}

The "instruction" field is 1-2 sentences that an image-gen model can act on. Be specific. Avoid generic words like "modern" or "professional."`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { brief, platform, format, design_language } = await req.json();
    if (!brief) return json({ error: "brief required" }, 400);

    let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: s } = await supabase.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
      anthropicKey = s?.value;
    }
    if (!anthropicKey) return json({ error: "no anthropic key" }, 400);

    const userMessage = `Brief: ${brief}
Platform: ${platform || "general"}
Format: ${format || "general"}
${design_language ? `Design language context: ${JSON.stringify(design_language).slice(0, 1500)}` : ""}

Generate 6 distinct angles.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: "Anthropic error", details: t }, 502);
    }
    const r = await resp.json();
    const text = r.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "no JSON in response", text }, 500);
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch (e) { return json({ error: "JSON parse error" }, 500); }
    if (!Array.isArray(parsed.angles) || parsed.angles.length === 0) return json({ error: "no angles" }, 500);
    return json({ angles: parsed.angles });
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
```

**Step 2: Commit + push**

```bash
git add supabase/functions/propose-design-angles/index.ts
git commit -m "feat(edge): propose-design-angles returns 6 creative-angle variants"
git push
```

---

### Task 6.2: Update `generate-post-image` to accept `variant_angle`

**Files:**
- Modify: [`supabase/functions/generate-post-image/index.ts`](supabase/functions/generate-post-image/index.ts)

**Step 1: Add `variant_angle` to the body destructure** and pass it to `buildImagePrompt`:

```ts
const { /* existing */, variant_angle } = await req.json();
// ...
const designPrompt = buildImagePrompt({
  /* existing fields */,
  variantAngle: variant_angle || null,
});
```

**Step 2: Commit + push**

```bash
git add supabase/functions/generate-post-image/index.ts
git commit -m "feat(edge): generate-post-image accepts variant_angle"
git push
```

---

### Task 6.3: Rewrite `CreatePostDesignButton` with multi-variant UI

This is the biggest UI change in the phase. I'll break it into sub-steps.

**Files:**
- Modify: [`src/components/reports/CreatePostDesignButton.tsx`](src/components/reports/CreatePostDesignButton.tsx)

**Step 1: Add variant-related state**

After the existing `useState` hooks, add:

```ts
const [variantCount, setVariantCount] = useState(isCarousel ? 2 : 4);
const [angles, setAngles] = useState<Array<{ label: string; instruction: string }>>([]);
const [selectedAngleIdxs, setSelectedAngleIdxs] = useState<number[]>([]);
const [fetchingAngles, setFetchingAngles] = useState(false);
const [variantGroupId, setVariantGroupId] = useState<string | null>(null);
const [favoriteIdxs, setFavoriteIdxs] = useState<Set<number>>(new Set());
// Map from variant slot index → image URL (or null while loading, or "FAILED" on error)
const [variantUrls, setVariantUrls] = useState<Array<string | null | "FAILED">>([]);
```

**Step 2: Fetch angles when modal opens**

Add a function:

```ts
const fetchAngles = async () => {
  setFetchingAngles(true);
  try {
    const { data } = await supabase.functions.invoke("propose-design-angles", {
      body: {
        brief: editablePrompt || defaultPrompt,
        platform: post.platform,
        format: post.format,
        design_language: clientContext?.design_style_synthesis || null,
      },
    });
    if (data?.angles && Array.isArray(data.angles)) {
      setAngles(data.angles.slice(0, 6));
      // Pre-select top N matching variantCount
      setSelectedAngleIdxs(Array.from({ length: Math.min(variantCount, data.angles.length) }, (_, i) => i));
    }
  } catch (e) {
    console.warn("Failed to fetch angles:", e);
    setAngles([]);
  } finally {
    setFetchingAngles(false);
  }
};
```

Trigger `fetchAngles` from `handleOpen` when the modal opens and angles is empty.

**Step 3: Replace `generateImages` with the variant-aware version**

```ts
const generateImages = async () => {
  const count = isCarousel
    ? slideCount                                    // carousel: count = slides per variant set; variants × slides
    : Math.min(Math.max(variantCount, 1), 6);

  // For now treat carousels as single-variant; multi-variant carousels are an extension.
  const variantsToRun = isCarousel ? 1 : count;
  const slidesPerVariant = isCarousel ? slideCount : 1;

  // Pick angle hints for each variant (or empty string for non-variant flows)
  const angleInstructions: string[] = [];
  if (!isCarousel && angles.length > 0 && selectedAngleIdxs.length > 0) {
    for (let i = 0; i < variantsToRun; i++) {
      const angleIdx = selectedAngleIdxs[i] ?? selectedAngleIdxs[selectedAngleIdxs.length - 1] ?? 0;
      angleInstructions.push(angles[angleIdx]?.instruction || "");
    }
  } else {
    for (let i = 0; i < variantsToRun; i++) angleInstructions.push("");
  }

  setLoading(true);
  setVariantUrls(new Array(variantsToRun).fill(null));
  setFavoriteIdxs(new Set());
  setVariantGroupId(crypto.randomUUID());

  // For carousel: keep existing sequential slide loop, no parallelism.
  if (isCarousel) {
    await runCarouselGeneration(slidesPerVariant);
    setLoading(false);
    return;
  }

  // For single image with N variants: fire all in parallel.
  const results = await Promise.allSettled(
    angleInstructions.map((angle) =>
      supabase.functions.invoke("generate-post-image", {
        body: {
          prompt: editablePrompt || defaultPrompt,
          platform: post.platform,
          format: post.format,
          brand_context: effectiveBrandIdentity || undefined,
          design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
          brand_book_file_path: effectiveBrandBookFilePath || undefined,
          client_context: clientContext || undefined,
          post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
          variant_angle: angle || undefined,
        },
      }),
    ),
  );

  // Process each result independently — fill the slot, persist
  const persistedUrls: Array<string | "FAILED"> = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.data?.image_url) {
      const dataUrl = r.value.data.image_url;
      const uploaded = await uploadVariantToStorage(dataUrl, i);
      persistedUrls.push(uploaded);
      setVariantUrls((prev) => {
        const next = [...prev];
        next[i] = uploaded;
        return next;
      });
      await persistVariantRow(uploaded, angleInstructions[i], variantGroupId, false);
    } else {
      persistedUrls.push("FAILED");
      setVariantUrls((prev) => {
        const next = [...prev];
        next[i] = "FAILED";
        return next;
      });
    }
  }

  setLoading(false);
};

const uploadVariantToStorage = async (dataUrl: string, idx: number): Promise<string> => {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const path = `${clientId || "unknown"}/${Date.now()}-variant-${idx}.png`;
    const { error } = await supabase.storage
      .from("generated-media")
      .upload(path, blob, { contentType: "image/png", upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("generated-media").getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error("Upload failed:", e);
    return dataUrl;
  }
};

const persistVariantRow = async (
  url: string,
  angle: string,
  groupId: string | null,
  isSelected: boolean,
) => {
  if (!clientId) return;
  await supabase.from("post_iterations").insert({
    client_id: clientId,
    platform: post.platform || null,
    post_copy: post.copy || null,
    visual_direction: post.visual_direction || post.ai_visual_prompt || null,
    format: post.format || null,
    source: "calendar",
    media_urls: [url],
    variant_group_id: groupId,
    variant_angle: angle || null,
    is_selected: isSelected,
  } as any);
};
```

(Carousel branch reuses existing logic; pull it into a helper.)

**Step 4: Variant grid UI**

Replace the "single image / grid" rendering block at [`src/components/reports/CreatePostDesignButton.tsx:374-447`](src/components/reports/CreatePostDesignButton.tsx:374) with a grid of N variant slots, each tile clickable to toggle favorite, with status indicator (loading/failed/done):

```tsx
{!loading && variantUrls.length > 0 && (
  <div className="space-y-3">
    <p className="text-xs text-muted-foreground">
      Tap a variant to mark it as a favorite. Favorites are saved with the post; the rest stay in the variant history.
    </p>
    <div className={`grid gap-2 ${variantUrls.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
      {variantUrls.map((url, i) => (
        <button
          key={i}
          type="button"
          onClick={() => toggleFavorite(i)}
          disabled={url === "FAILED" || url === null}
          className={`relative aspect-square rounded-md border overflow-hidden transition-all ${
            favoriteIdxs.has(i) ? "ring-2 ring-primary border-primary" : ""
          }`}
        >
          {url === null && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {url === "FAILED" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-destructive p-2 text-center">
              Failed
              <span className="text-[10px] underline mt-1">Retry</span>
            </div>
          )}
          {typeof url === "string" && url !== "FAILED" && (
            <img src={url} alt={`Variant ${i + 1}`} className="w-full h-full object-cover" />
          )}
          {favoriteIdxs.has(i) && (
            <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-1">
              <Check className="h-3 w-3" />
            </div>
          )}
          {angles[selectedAngleIdxs[i]] && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-2 py-1 truncate">
              {angles[selectedAngleIdxs[i]].label}
            </div>
          )}
        </button>
      ))}
    </div>
    <div className="flex items-center gap-2">
      <Button onClick={generateImages}>
        <Paintbrush className="h-4 w-4 mr-1" /> Regenerate
      </Button>
      <Button variant="ghost" onClick={saveFavorites} disabled={favoriteIdxs.size === 0}>
        Use {favoriteIdxs.size} favorite{favoriteIdxs.size === 1 ? "" : "s"}
      </Button>
    </div>
  </div>
)}
```

Define `toggleFavorite` and `saveFavorites`:

```ts
const toggleFavorite = (i: number) => {
  setFavoriteIdxs((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
};

const saveFavorites = async () => {
  if (!variantGroupId) return;
  const favoriteUrls = Array.from(favoriteIdxs)
    .map((i) => (typeof variantUrls[i] === "string" ? (variantUrls[i] as string) : null))
    .filter((u): u is string => !!u);
  // Update is_selected on persisted rows: mark favorites true, others false.
  await supabase
    .from("post_iterations")
    .update({ is_selected: false } as any)
    .eq("variant_group_id", variantGroupId);
  for (const url of favoriteUrls) {
    await supabase
      .from("post_iterations")
      .update({ is_selected: true } as any)
      .eq("variant_group_id", variantGroupId)
      .contains("media_urls", [url]);
  }
  if (onImagesGenerated) onImagesGenerated(favoriteUrls);
  toast.success(`Saved ${favoriteUrls.length} favorite${favoriteUrls.length === 1 ? "" : "s"}`);
};
```

**Step 5: Add the variant count slider + angle list to the modal**

Insert in the modal body (between brand colors indicator and prompt textarea):

```tsx
{!isCarousel && (
  <div className="space-y-2">
    <Label>Number of variants</Label>
    <div className="flex items-center gap-2">
      <input
        type="range" min={2} max={6} value={variantCount}
        onChange={(e) => setVariantCount(parseInt(e.target.value))}
        disabled={loading}
        className="flex-1"
      />
      <span className="text-xs font-medium w-8 text-center">{variantCount}</span>
    </div>
    <p className="text-[10px] text-muted-foreground">
      More variants = more options to pick from. Generation runs in parallel.
    </p>
  </div>
)}

{!isCarousel && angles.length > 0 && (
  <div className="space-y-2">
    <Label>Suggested angles</Label>
    <div className="space-y-1 max-h-40 overflow-y-auto">
      {angles.map((a, i) => (
        <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={selectedAngleIdxs.includes(i)}
            disabled={loading}
            onChange={(e) => {
              setSelectedAngleIdxs((prev) =>
                e.target.checked
                  ? [...prev, i].slice(0, variantCount)
                  : prev.filter((x) => x !== i),
              );
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">{a.label}.</span> {a.instruction}
          </span>
        </label>
      ))}
    </div>
  </div>
)}
```

**Step 6: TS check + commit + push**

```bash
npx tsc --noEmit 2>&1 | head -20
git add src/components/reports/CreatePostDesignButton.tsx
git commit -m "feat(reports): multi-variant image generation with angle picker"
git push
```

---

### Task 6.4: Manual verification

1. Open test post, click Design.
2. Modal opens, "Suggested angles" populate within a few seconds.
3. Variant slider 2-6. Select 4. Click Generate.
4. 4 skeleton tiles, fill in as variants complete (in any order).
5. Click 2 favorites → "Use 2 favorites" → toast confirms.
6. SQL: `select id, variant_group_id, is_selected, variant_angle from post_iterations where variant_group_id is not null order by created_at desc limit 8;` confirms 4 rows under the same group, 2 selected, 2 not.

---

## Phase 7 — Multi-variant video (L4 part 2)

### Task 7.1: Update `generate-post-video` to accept `variant_angle`

**Files:**
- Modify: [`supabase/functions/generate-post-video/index.ts`](supabase/functions/generate-post-video/index.ts)

Add `variant_angle` to the body destructure and pass to `buildVideoPrompt`. Commit:

```bash
git add supabase/functions/generate-post-video/index.ts
git commit -m "feat(edge): generate-post-video accepts variant_angle"
git push
```

---

### Task 7.2: Add 2-3 variant UI to `CreatePostVideoButton`

Mirror Phase 6's pattern, but default variant count to 2 and cap at 3 (Veo is slow). Same `propose-design-angles` call (it doesn't care if the brief is for video). Parallel `generate-post-video` invocations.

Persist with `variant_group_id` etc. Commit + push.

```bash
git add src/components/reports/CreatePostVideoButton.tsx
git commit -m "feat(reports): multi-variant video generation (2-3 variants)"
git push
```

---

### Task 7.3: Manual verification

Generate 2 video variants on a Reel-format test post. Verify 2 parallel Veo invocations in logs, 2 rows in `post_iterations` with shared `variant_group_id`, favorite-selection persists.

---

## Phase 8 — Content Ideas tab redesign (L5)

This is the largest UI change. Break into small components.

### Task 8.1: Create `useRealtimePostIterations` hook

**Files:**
- Create: `src/hooks/useRealtimePostIterations.ts`

```ts
// src/hooks/useRealtimePostIterations.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimePostIterations(clientId?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`post-iterations-${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_iterations",
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, qc]);
}
```

Commit:

```bash
git add src/hooks/useRealtimePostIterations.ts
git commit -m "feat(hooks): realtime subscription for post_iterations scoped to clientId"
```

---

### Task 8.2: Create `PostStatusChip`

**Files:**
- Create: `src/components/reports/calendar/PostStatusChip.tsx`

```tsx
// src/components/reports/calendar/PostStatusChip.tsx
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

export type PostStatus = "draft" | "designed" | "approved" | "scheduled" | "published";

const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  designed: "Designed",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

const STATUS_CLASS: Record<PostStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  designed: "bg-secondary text-secondary-foreground",
  approved: "bg-accent text-accent-foreground",
  scheduled: "bg-primary text-primary-foreground",
  published: "bg-success text-success-foreground",
};

export function PostStatusChip({
  status,
  onToggleApproved,
}: {
  status: PostStatus;
  onToggleApproved?: () => void;
}) {
  const { isClient } = useAuth();
  const clickable = !isClient && (status === "designed" || status === "approved") && onToggleApproved;
  return (
    <Badge
      className={`${STATUS_CLASS[status]} ${clickable ? "cursor-pointer hover:opacity-80" : ""}`}
      onClick={clickable ? onToggleApproved : undefined}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
```

Commit.

---

### Task 8.3: Create the post status resolver helper

**Files:**
- Create: `src/components/reports/calendar/postStatus.ts`

```ts
// src/components/reports/calendar/postStatus.ts
import type { PostStatus } from "./PostStatusChip";

export function resolvePostStatus(args: {
  mediaUrls: string[];
  isSelectedAny: boolean;
  isApproved: boolean;
  hasScheduledPost: boolean;
}): PostStatus {
  if (args.hasScheduledPost) return "scheduled";
  if (args.isApproved) return "approved";
  if (args.mediaUrls.length > 0 && args.isSelectedAny) return "designed";
  return "draft";
}
```

Quick test:

```ts
// src/test/calendar/postStatus.test.ts
import { describe, it, expect } from "vitest";
import { resolvePostStatus } from "../../components/reports/calendar/postStatus";

describe("resolvePostStatus", () => {
  it("defaults to draft", () => {
    expect(resolvePostStatus({ mediaUrls: [], isSelectedAny: false, isApproved: false, hasScheduledPost: false })).toBe("draft");
  });
  it("scheduled wins over approved", () => {
    expect(resolvePostStatus({ mediaUrls: ["u"], isSelectedAny: true, isApproved: true, hasScheduledPost: true })).toBe("scheduled");
  });
  it("approved before designed", () => {
    expect(resolvePostStatus({ mediaUrls: ["u"], isSelectedAny: true, isApproved: true, hasScheduledPost: false })).toBe("approved");
  });
  it("designed requires both media + selected", () => {
    expect(resolvePostStatus({ mediaUrls: ["u"], isSelectedAny: false, isApproved: false, hasScheduledPost: false })).toBe("draft");
  });
});
```

Commit.

---

### Task 8.4: Create `WeeklyHighlights`

**Files:**
- Create: `src/components/reports/calendar/WeeklyHighlights.tsx`

Collapsible card pulling from `aiAnalysis`. Shows month-over-month summary, top trend opportunities, pillar gaps. Collapsed by default. ~80 lines of UI.

Use the existing card styles (`.glass`, `.glass-inner`). Pattern:

```tsx
export function WeeklyHighlights({ aiAnalysis, sproutMonthSummary }: Props) {
  const [open, setOpen] = useState(false);
  // ...
  return (
    <Card className="glass-inner">
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        Weekly highlights
      </CardHeader>
      {open && <CardContent>...</CardContent>}
    </Card>
  );
}
```

Commit.

---

### Task 8.5: Create `CalendarFilters`

**Files:**
- Create: `src/components/reports/calendar/CalendarFilters.tsx`

Sticky chip row above the kanban: day · platform · status · language. Uses shadcn `Toggle` or simple `Badge` buttons.

Maintains filter state as a single object: `{ day, platform, status, language }`. Lifts state via callbacks.

Commit.

---

### Task 8.6: Create `PostCard`

**Files:**
- Create: `src/components/reports/calendar/PostCard.tsx`

Single collapsed card per the design doc spec. Receives `post`, `iteration` (latest for this post — joined client-side), `clientContext`, and `onOpen` callback.

Renders:
- Top row: badges + posting time
- Middle: 2-line truncated copy
- Bottom: thumbnail (from `iteration.media_urls[0]` if `iteration.is_selected`) or "+ Design" placeholder
- Bottom bar: status chip + overflow menu

Click anywhere on the card → `onOpen()`. The overflow `⋮` menu stops propagation.

Commit.

---

### Task 8.7: Create `PostPanel`

**Files:**
- Create: `src/components/reports/calendar/PostPanel.tsx`

Right-side `<Sheet>` from shadcn (already in `src/components/ui/sheet.tsx`). 640px wide. Four sub-tabs.

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function PostPanel({ open, onOpenChange, post, iteration, clientContext, clientId, reportId, clientTimezone }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>{post.platform} · {post.format}</SheetTitle></SheetHeader>
        <Tabs defaultValue="copy" className="mt-4">
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="copy">Copy</TabsTrigger>
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="video">Video</TabsTrigger>
            <TabsTrigger value="schedule" disabled={isClient}>Schedule</TabsTrigger>
          </TabsList>
          <TabsContent value="copy">{/* CopyEditor — extract from current CalendarPostCard inline edit logic */}</TabsContent>
          <TabsContent value="design"><CreatePostDesignButton post={post} clientContext={clientContext} clientId={clientId} /></TabsContent>
          <TabsContent value="video"><CreatePostVideoButton post={post} clientContext={clientContext} clientId={clientId} /></TabsContent>
          <TabsContent value="schedule"><SchedulePostInline post={post} clientId={clientId} reportId={reportId} clientTimezone={clientTimezone} /></TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
```

Extract `CopyEditor` from the inline copy-edit JSX in current [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx) (around lines 794-840) into its own component. Same for `SchedulePostInline` — the schedule UI from `SchedulePostModal` lifted into a non-modal panel form.

Commit.

---

### Task 8.8: Create `CalendarKanban`

**Files:**
- Create: `src/components/reports/calendar/CalendarKanban.tsx`

7-column horizontal kanban, one column per weekday. On `<lg` viewports, stacks vertically. Renders `PostCard` for each post.

```tsx
export function CalendarKanban({ contentCalendar, postIterations, clientContext, clientId, reportId, filters, onCardClick }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-7 gap-2">
      {contentCalendar.map((day, dayIdx) => (
        <div key={dayIdx} className="space-y-2">
          <div className="text-xs font-semibold sticky top-0 bg-background py-2">{day.day}</div>
          {(day.posts || []).filter((p) => matchesFilters(p, filters)).map((post, postIdx) => (
            <PostCard
              key={postIdx}
              post={post}
              iteration={findLatestSelectedIteration(postIterations, post)}
              clientContext={clientContext}
              onOpen={() => onCardClick(post)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

`findLatestSelectedIteration` matches the post to the latest `post_iterations` row by `(platform, post_copy)` similarity (this is the same heuristic the current code uses).

Commit.

---

### Task 8.9: Create `ContentIdeasTab`

**Files:**
- Create: `src/components/reports/calendar/ContentIdeasTab.tsx`

Top-level component for the tab. Owns the filter state, the active post (for panel), and queries `post_iterations` once for the client.

```tsx
export function ContentIdeasTab({ contentCalendar, aiAnalysis, sproutPerformance, clientContext, clientId, reportId, clientTimezone, availablePlatforms }: Props) {
  const [filters, setFilters] = useState({ day: "all", platform: "all", status: "all", language: "all" });
  const [activePost, setActivePost] = useState<any | null>(null);

  useRealtimePostIterations(clientId);

  const { data: postIterations = [] } = useQuery({
    queryKey: ["post-iterations", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data } = await supabase.from("post_iterations").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!clientId,
  });

  return (
    <div className="space-y-4">
      {availablePlatforms.length > 0 && (
        <div className="flex justify-end">
          <CreateAdHocPost clientId={clientId!} platforms={availablePlatforms} clientContext={clientContext} />
        </div>
      )}
      <WeeklyHighlights aiAnalysis={aiAnalysis} sproutMonthSummary={sproutPerformance?.month_comparison?.summary} />
      <CalendarFilters filters={filters} onChange={setFilters} availablePlatforms={availablePlatforms} availableLanguages={...} />
      <CalendarKanban
        contentCalendar={contentCalendar}
        postIterations={postIterations}
        clientContext={clientContext}
        clientId={clientId}
        reportId={reportId}
        filters={filters}
        onCardClick={setActivePost}
      />
      <PostPanel
        open={!!activePost}
        onOpenChange={(open) => !open && setActivePost(null)}
        post={activePost}
        iteration={activePost ? findLatestSelectedIteration(postIterations, activePost) : null}
        clientContext={clientContext}
        clientId={clientId}
        reportId={reportId}
        clientTimezone={clientTimezone}
      />
    </div>
  );
}
```

Commit.

---

### Task 8.10: Wire `ContentIdeasTab` into `ReportView`

**Files:**
- Modify: [`src/pages/ReportView.tsx`](src/pages/ReportView.tsx)

Replace the entire `<TabsContent value="content">` block (lines 382-437) with:

```tsx
<TabsContent value="content" className="space-y-4">
  <ContentIdeasTab
    contentCalendar={contentCalendar}
    aiAnalysis={aiAnalysis}
    sproutPerformance={sproutPerformance}
    clientContext={clientContext}
    clientId={id}
    reportId={reportId}
    clientTimezone={rd?.context?.timezone || "UTC"}
    availablePlatforms={availablePlatforms}
  />
</TabsContent>
```

Add the import. Delete the now-unused `CalendarPostCard` and `ContentRecommendations` functions further down ReportView — these are subsumed.

Test PDF export still works on Lovable preview (the ExportPdfButton should snapshot whatever's on the page; the kanban is renderable HTML).

Commit + push.

```bash
git add src/pages/ReportView.tsx src/components/reports/calendar/
git commit -m "feat(reports): kanban + side panel replace inline Content Ideas UI"
git push
```

---

### Task 8.11: Print styles for PDF export

**Files:**
- Modify: `src/components/reports/calendar/CalendarKanban.tsx`, `PostPanel.tsx`, `WeeklyHighlights.tsx`, `CalendarFilters.tsx`

Use Tailwind `print:` variants on container elements:

```tsx
// CalendarKanban: force single column when printing
<div className="grid grid-cols-1 lg:grid-cols-7 gap-2 print:grid-cols-1">

// CalendarFilters: hide on print
<div className="... print:hidden">

// PostPanel sheet: never visible in print (it's overlay)
```

For posts inside the kanban, ensure full content is visible (no truncation):
```tsx
// PostCard: undo 2-line clamp on print
<p className="text-sm line-clamp-2 print:line-clamp-none">...</p>
```

Commit + push.

---

### Task 8.12: Manual verification

1. Load a report with at least one full week of calendar posts on test client.
2. Verify kanban renders 7 columns on desktop, stack on mobile.
3. Click a card → side panel opens. All 4 sub-tabs work.
4. Generate a design (Phase 6 flow inside the Design sub-tab). Confirm card thumbnail updates after favorite selection.
5. Edit copy in the Copy sub-tab. Confirm `analyze-post-edits` is invoked (Supabase logs) — preserves the learning loop.
6. Schedule a post from the Schedule sub-tab. Confirm `scheduled_posts` row created.
7. Switch user role to "client" (or test with a client account). Verify Approve and Schedule sub-tab hidden/disabled.
8. PDF export — open print preview, confirm kanban flattens to a single column, filters chrome hidden.

---

## Phase 9 — n8n workflow update (L7)

### Task 9.1: Edit `Build Normalized Client Object` node

**Files:**
- Modify: `/Users/user/Documents/AI Workflows/SM Team/May 18/Socialytics - AI Social Media Trend Analysis + Insights Agent - Loveable - Final.json`

**Step 1: Open the JSON** in a text editor. Search for `Build Normalized Client Object`. Find the `jsCode` parameter. Locate the `context: { ... }` block within the `normalizedClient` object.

**Step 2: Add three fields** to the `context` object:

```js
context: {
  // ... existing fields ...
  brief_context: clientData.brief_context || {},
  content_pillars: clientData.content_pillars || [],
  design_style_synthesis: clientData.design_style_synthesis || null,
  has_design_references: Array.isArray(clientData.design_references) && clientData.design_references.length > 0,
  has_brand_book: !!clientData.brand_book_file_path,
},
```

**Step 3: Ensure `Combine Brief Context with Client Data` projects these fields**

In that node's `jsCode`, where the Supabase client row is read, confirm the projection includes `design_style_synthesis, design_references, brand_book_file_path`. If not, expand the `.select(...)` call to include them.

---

### Task 9.2: Edit `AI Synthesis Agent` system message

**Files:**
- Same JSON file.

**Step 1: Search** for `## BRAND BOOK GUIDELINES` in the `systemMessage` field.

**Step 2: Insert a new section immediately after** that block and before `## LANGUAGE & REGION REQUIREMENTS`:

```
## BRAND DESIGN LANGUAGE
{{ $json.context.design_style_synthesis
  ? 'The client\'s extracted design language is: ' + JSON.stringify($json.context.design_style_synthesis) + '. EVERY ai_visual_prompt and visual_direction MUST be written in alignment with these patterns — composition, typography, imagery, color usage, surface, logo treatment, mood, and platform adaptations. Do NOT include hex color codes, RGB values, or any technical color notation anywhere in visual_direction or ai_visual_prompt — describe colors qualitatively (e.g., "warm coral accent on a deep navy ground") because hex codes leak into rendered images downstream.'
  : 'No extracted design language available. Use general best-practices and the brand_voice + brand_book_text above for visual direction.' }}
```

**Step 3: Add a hex-code guard** near the end of the system message, in the `CRITICAL OUTPUT RULES` section:

```
8. Never include any hex color codes, RGB values, or technical color notation in visual_direction or ai_visual_prompt. Downstream image and video generation models will render those codes as visible text in the generated outputs.
```

**Step 4: Save the JSON file**

**Step 5: Re-import into n8n** via the n8n UI (Workflows → Import from File).

**Step 6: Trigger a fresh report run** for a test client that has `design_style_synthesis` populated. Verify the generated `visual_direction` and `ai_visual_prompt` fields describe colors qualitatively and reference the brand's design patterns.

---

## Final verification (after all phases land)

Walk through this end-to-end on a test client (`test-client-XX`):

1. **Onboarding**: Upload 4 design refs + brand book. Wait for "Synthesized" status. Verify `clients.design_style_synthesis` populated.
2. **Trigger a report run**. Verify the calendar's `visual_direction` and `ai_visual_prompt` reference the design language and contain no hex codes.
3. **Open the report → Content Ideas tab**. Kanban renders, 7 columns, posts grouped by day, status chips visible.
4. **Click a post → side panel opens**.
5. **Copy tab**: edit copy, save. Confirm `analyze-post-edits` log.
6. **Design tab**: generate 4 variants. Confirm 4 parallel `generate-post-image` calls with `variant_angle` set. Pick 2 favorites. Confirm thumbnail updates on the card.
7. **Video tab**: generate 2 video variants (on a video-format post). Confirm 2 parallel Veo calls. Pick a favorite.
8. **Schedule tab**: pick a Sprout profile, schedule. Confirm `scheduled_posts` row + status chip updates to "Scheduled".
9. **Client role**: log in as a client account. Confirm no Approve, no Schedule, but Design/Copy/Video work.
10. **Export PDF**: confirm kanban flattens, all content present.
11. **Spot check 5 generated designs for hex codes** rendered as visible text in the images. Should be zero — or extremely rare.

---

## Plan complete

This plan implements the full design-pipeline-v2 design doc. Each phase is independently shippable. Push after each commit to get Lovable preview deploys.

**Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch fresh subagents per task, review their work between tasks, fast iteration in this conversation.

**2. Parallel Session (separate)** — You open a new session in the worktree and use the executing-plans skill there. Batch execution with checkpoints.

Which approach?

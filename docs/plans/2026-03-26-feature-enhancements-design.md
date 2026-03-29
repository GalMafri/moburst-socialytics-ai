# Socialytics Feature Enhancements Design

**Date:** 2026-03-26
**Status:** Approved

## Summary

Five features to enhance the Socialytics platform:
1. Brand book upload + color extraction in onboarding + timezone
2. Sprout Social post scheduling from content calendar
3. Enhanced design generation with brand design references
4. Video generation (Google Veo) in content calendar
5. Client deletion (soft + hard delete)

---

## Feature 1: Brand Book Upload + Color Extraction + Timezone

### Changes to Client Onboarding (ClientSetup.tsx)

**Brief tab — replace `brand_book_text` text field with Brand Book section:**
- **File upload**: PDF, PNG, JPG, JPEG → stored in Supabase Storage bucket `brand-books`
- **URL input**: Brand book URL → scraped via existing `research-brand-identity` function
- After upload/URL submit, extract brand colors/fonts/style into `brand_identity` JSON
- Remove the old `brand_book_text` text field from UI

**Client Info tab — add timezone:**
- Timezone dropdown using IANA timezone list (e.g., America/New_York, Europe/London)
- Default: UTC
- Used in content calendar posting times in reports

### New Supabase Edge Function: `extract-brand-from-file`
- Accepts file from Supabase Storage
- Sends to OpenAI GPT-4.1 Vision (same model as `research-brand-identity`)
- Extracts: primary_color, secondary_color, accent_color, font_family, visual_style, logo_description, tone_of_voice, design_elements, background_style
- Returns same `brand_identity` JSON structure

### Database Changes
- Add `brand_book_url` (text, nullable) to `clients`
- Add `brand_book_file_path` (text, nullable) to `clients`
- Add `timezone` (text, nullable, default 'UTC') to `clients`
- Deprecate `brand_book_text` (keep column, remove from UI)

### n8n Workflow Changes
- Pass `timezone` in webhook payload
- AI Synthesis Agent uses timezone for content calendar posting times

---

## Feature 2: Sprout Social Post Scheduling

### UI: Schedule Modal (new component)
Triggered by "Schedule to Sprout" button on each content calendar post.

**Modal contents:**
- Profile selector — dropdown filtered to post's platform from client's `sprout_profiles`
- Date & time picker — pre-filled from post's date/time, adjusted to client timezone
- Post copy editor — pre-filled, editable
- Media attachment — show generated design if exists, allow upload/replace
- Preview panel
- Schedule button

**Bulk scheduling:**
- "Schedule All" button at top of content calendar
- Review step showing all posts with times/profiles before confirming

### New Supabase Edge Function: `schedule-sprout-post`
- Uses Sprout Social Publishing API: `POST /v1/{customer_id}/publishing/posts`
- Payload: profile_ids, text, scheduled_time, media (optional)
- Returns: scheduled post ID
- Handles OAuth2 token refresh

### New Database Table: `scheduled_posts`
```sql
CREATE TABLE scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  report_id UUID REFERENCES reports(id),
  sprout_post_id TEXT,
  profile_id UUID REFERENCES sprout_profiles(id),
  platform TEXT,
  scheduled_time TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled', -- scheduled, published, failed
  post_content TEXT,
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);
```

---

## Feature 3: Enhanced Design with Brand References

### Changes to Client Onboarding (ClientSetup.tsx)
**Brief tab — add "Design References" section (below Brand Book):**
- Multi-file upload: PNG, JPG (example social posts, ads, design samples)
- Stored in Supabase Storage bucket `design-references`
- File paths saved as JSON array in `design_references` field

### Changes to `generate-post-image` Edge Function
- Fetch client's design reference images from storage
- Fetch brand book file (if uploaded) from storage
- Include both as visual context in Gemini multimodal prompt
- Enhanced prompt: "Use these existing brand designs as style references. Match their visual language, layout patterns, color usage, and overall aesthetic."

### Database Changes
- Add `design_references` (JSONB, nullable) to `clients` — array of storage file paths

---

## Feature 4: Video Generation (Google Veo)

### UI: "Create Video" Button
- Added alongside "Create Design" on each content calendar post
- Prominent for video formats (reel, story, tiktok); secondary for static formats
- Loading state with progress (30-120 seconds generation time)
- Inline video preview with play controls
- Download button
- Re-generate with modified prompt option
- Video attachable when scheduling to Sprout (Feature 2)

### New Supabase Edge Function: `generate-post-video`
- Uses Google Veo via Gemini API (`generateVideos` endpoint)
- Input: enhanced `ai_visual_prompt` (with motion/transition/duration direction), brand context
- Aspect ratios: 9:16 (stories/reels/TikTok), 16:9 (LinkedIn), 1:1 (default)
- Duration: 5-10 seconds for short-form content
- Returns: video URL from Google's file API

### Prompt Enhancement
- Adapts existing `ai_visual_prompt` for video:
  - Adds scene transitions and movement direction
  - Specifies duration and pacing
  - Includes brand motion guidelines if available

---

## Feature 5: Client Deletion (Soft + Hard)

### Soft Delete (Archive)
- Add `archived_at` (timestamptz, nullable) to `clients`
- Three-dot menu on client cards in AdminDashboard → "Archive Client"
- Confirmation dialog before archiving
- Archived clients hidden from main dashboard by default
- "Show Archived" toggle/filter on AdminDashboard
- Archived clients shown greyed out with "Archived" badge
- "Restore" option (sets `archived_at = null`)

### Hard Delete (Permanent)
- Only available on archived clients
- "Permanently Delete" with double confirmation (type client name)
- New Supabase Edge Function `delete-client` handles cascading:
  - Delete: scheduled_posts → report_schedules → sprout_profiles → client_users → reports → client
  - Also deletes files from Storage (brand-books, design-references)

---

## Database Migration Summary

```sql
-- Feature 1
ALTER TABLE clients ADD COLUMN brand_book_url TEXT;
ALTER TABLE clients ADD COLUMN brand_book_file_path TEXT;
ALTER TABLE clients ADD COLUMN timezone TEXT DEFAULT 'UTC';

-- Feature 2
CREATE TABLE scheduled_posts (...); -- see Feature 2 section

-- Feature 3
ALTER TABLE clients ADD COLUMN design_references JSONB;

-- Feature 5
ALTER TABLE clients ADD COLUMN archived_at TIMESTAMPTZ;
```

## New Supabase Storage Buckets
- `brand-books` — brand book PDF/image files
- `design-references` — design reference images

## New Supabase Edge Functions
1. `extract-brand-from-file` — GPT-4.1 Vision brand extraction from files
2. `schedule-sprout-post` — Sprout Social Publishing API
3. `generate-post-video` — Google Veo video generation
4. `delete-client` — Cascading client deletion

## Modified Files (Frontend)
- `src/pages/ClientSetup.tsx` — brand book upload, design refs, timezone, remove brand_book_text
- `src/pages/ReportView.tsx` — schedule buttons, video buttons on content calendar
- `src/components/dashboard/AdminDashboard.tsx` — archive/delete UI, archived filter
- `src/components/reports/CreatePostDesignButton.tsx` — enhanced with design refs
- `src/integrations/supabase/types.ts` — new types
- New components: SchedulePostModal, CreatePostVideoButton, BrandBookUpload, DesignReferencesUpload

## Modified Files (n8n)
- Webhook payload: add `timezone` field
- AI Synthesis Agent prompt: use timezone for posting times

# Socialytics V2 — Setup Guide

## Overview of New Features

1. **Persistent Memory** — AI learns from client edits and adapts tone/voice over time
2. **In-App Design Editor** — Fabric.js canvas editor for tweaking AI-generated images
3. **Regional/Seasonal Context** — Content calendar considers holidays and cultural events
4. **Ad-Hoc Post Generation** — Create one-off posts outside the content calendar
5. **Copy Regeneration** — Regenerate post copy on existing recommendations
6. **Hex Code Fix** — Design prompts no longer render color codes as visible text
7. **Creative Type Adaptation** — Design prompts adapt when user picks a different format

---

## 1. Required Supabase Secrets

Add this secret to your Supabase project. The others (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) should already be configured.

| Secret | Purpose | How to Get |
|--------|---------|-----------|
| `ANTHROPIC_API_KEY` | Claude API — copy generation, vision validation, prompt adaptation, edit analysis | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |

### Adding via Supabase Dashboard:
1. Go to your Supabase project
2. Navigate to **Project Settings > Edge Functions > Secrets**
3. Click **Add Secret**
4. Name: `ANTHROPIC_API_KEY`, Value: `sk-ant-...` (your key)

### Adding via CLI:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### If using Lovable:
Add `ANTHROPIC_API_KEY` through Lovable's environment variable UI for Supabase secrets.

---

## 2. Database Migrations

Three new tables need to be created. Run these SQL migrations in your Supabase dashboard (SQL Editor) or via CLI:

```bash
supabase db push
```

Migration files:
- `supabase/migrations/20260415000001_add_post_iterations.sql` — Tracks every version of post copy edits
- `supabase/migrations/20260415000002_add_brand_voice_learnings.sql` — Stores AI-learned voice preferences per client
- `supabase/migrations/20260415000003_add_design_states.sql` — Saves Fabric.js canvas states for the editor

### Tables Created

| Table | Purpose |
|-------|---------|
| `post_iterations` | Version history of all post edits (calendar, ad-hoc, regenerations) |
| `brand_voice_learnings` | Per-client voice preferences extracted from edits (tone, length, emoji, CTA style, etc.) |
| `design_states` | Saved canvas JSON for the in-app editor (resume edits, templates) |

---

## 3. New Edge Functions to Deploy

These 5 new edge functions need to be deployed alongside the existing ones:

| Function | Purpose | AI Model Used |
|----------|---------|---------------|
| `validate-design-output` | Checks generated images/video frames for visible hex codes | Claude Haiku (vision) |
| `adapt-creative-prompt` | Rewrites design prompts when user picks a different creative format | Claude Haiku |
| `analyze-post-edits` | Extracts brand voice patterns from user edits to AI copy | Claude Haiku |
| `generate-ad-hoc-post` | Creates one-off posts outside the content calendar | Claude Sonnet |
| `regenerate-post-copy` | Generates fresh copy for existing recommendations | Claude Haiku |

### Deploy via CLI:
```bash
supabase functions deploy validate-design-output
supabase functions deploy adapt-creative-prompt
supabase functions deploy analyze-post-edits
supabase functions deploy generate-ad-hoc-post
supabase functions deploy regenerate-post-copy
```

### Deploy via Lovable:
Edge functions deploy automatically when you push to the connected GitHub repo.

---

## 4. n8n Workflow Update

The n8n workflow JSON has been updated with two new prompt sections in the AI Synthesis Agent:

1. **Brand Voice Learnings** — Instructs the AI to apply learned voice preferences from past client feedback
2. **Seasonal/Regional Context** — Instructs the AI to consider the client's timezone/region and incorporate relevant events

### To apply:
1. Open your n8n instance
2. Import the updated workflow JSON: `SociaIytics AI - AI Social Media Trend Analysis + Insights Agent - Final MVP - AI Week.json`
3. The changes are in the AI Synthesis Agent's system prompt only — no new nodes or connections were added

### Future enhancement:
For the voice learnings to flow from Supabase into n8n, add an HTTP Request node before the AI Synthesis Agent that fetches from:
```
GET https://rwouwxqggjjacbpbhqsn.supabase.co/rest/v1/brand_voice_learnings?client_id=eq.{CLIENT_ID}&order=confidence.desc&limit=10
```
With headers: `apikey` and `Authorization: Bearer {service_role_key}`

---

## 5. Frontend Dependencies

One new npm package was added:

```bash
npm install fabric@6
```

This is already included in package.json and will install automatically on `npm install`.

---

## 6. New Frontend Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DesignEditor` | `src/components/editor/DesignEditor.tsx` | Fabric.js canvas editor for images |
| `VideoTrimmer` | `src/components/editor/VideoTrimmer.tsx` | Lightweight video editor (trim, text overlay) |
| `CreateAdHocPost` | `src/components/reports/CreateAdHocPost.tsx` | Dialog for creating posts outside the calendar |

### Modified Components

| Component | What Changed |
|-----------|-------------|
| `ReportView.tsx` | Added edit/regenerate buttons on post cards, ad-hoc post creation, passed clientId to design buttons |
| `ClientSetup.tsx` | Added "Learned Voice Preferences" section showing AI-extracted patterns |
| `CreatePostDesignButton.tsx` | Added hex code validation, format adaptation, edit button linking to DesignEditor |
| `CreatePostVideoButton.tsx` | Added hex code guardrails, format adaptation for non-video recommendations |

### New Utility

| File | Purpose |
|------|---------|
| `src/utils/sanitizeDesignPrompt.ts` | Hex code sanitization utilities for design prompts |

---

## 7. How It All Works Together

### Post Iteration Memory Flow:
```
User edits AI copy → saved to post_iterations (v1 + v2)
                   → analyze-post-edits extracts patterns
                   → patterns saved to brand_voice_learnings
                   → next content calendar generation reads learnings
                   → AI applies learned preferences
```

### Design Generation Flow (with fixes):
```
User clicks "Generate Design"
  → format mismatch? → adapt-creative-prompt rewrites visual direction
  → hex codes sanitized in prompt structure
  → Gemini generates image
  → validate-design-output checks for hex codes (Claude vision)
  → hex codes found? → auto-retry with stronger constraint
  → user can Edit (DesignEditor) → Download or Schedule
```

### Ad-Hoc Post Flow:
```
User clicks "Create Post" in Content Ideas tab
  → enters platform, topic, creative type
  → generate-ad-hoc-post (Claude Sonnet) creates full post
  → saved to post_iterations (source: ad_hoc)
  → user can Generate Design, Generate Video, Copy Caption
```

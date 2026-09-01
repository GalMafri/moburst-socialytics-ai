# Higgsfield integration

Socialytics generates post images and videos through the Higgsfield REST API
(`api.higgsfield.ai`). This replaced the Gemini 3.1 Flash Image + Veo chain in
September 2026. The prompt builders (`supabase/functions/_shared/design-prompts/`)
are unchanged; only the model provider behind them moved.

There are two separate Higgsfield surfaces. Do not confuse them:

| Surface | Auth | Used by |
| --- | --- | --- |
| REST API `api.higgsfield.ai` | `Authorization: Key <id>:<secret>` | The app's edge functions. Unattended, all clients, all users |
| Hosted MCP `https://mcp.higgsfield.ai/mcp` | Personal Higgsfield account, interactive | Individual team members in Claude Code / Cowork, for ad hoc generation |

## Configuration (Supabase edge secrets)

Set in the Supabase dashboard under Edge Functions → Secrets. Never in
`app_settings` — that table is readable client-side by all staff sessions.

| Secret | Required | Purpose |
| --- | --- | --- |
| `HIGGSFIELD_API_KEY_ID` | yes | REST key id |
| `HIGGSFIELD_API_KEY_SECRET` | yes | REST key secret |
| `HIGGSFIELD_WEBHOOK_SECRET` | yes for video | Shared secret in the webhook URL (`?t=`). Generate a long random string |
| `HIGGSFIELD_IMAGE_MODEL_PATH` | no | Defaults to `/higgsfield-ai/soul/standard` (prompt-only route) |
| `HIGGSFIELD_IMAGE_REFERENCE_MODEL_PATH` | no | Defaults to `/higgsfield-ai/soul/reference` (used whenever a design reference exists; takes ONE `image_reference_url`) |
| `HIGGSFIELD_VIDEO_MODEL_PATH` | no | Defaults to `/higgsfield-ai/dop/standard` (image-to-video; `image_url` is required, so the seed frame is mandatory) |
| `HIGGSFIELD_VIDEO_PARAMS` | no | JSON object merged into every video submission (duration/quality knobs, which are model-specific) |

Routes come from Higgsfield's OpenAPI spec (docs.higgsfield.ai/docs/openapi.json).
Beware: the quickstart page shows `/soul/v2/standard`, but no `/v2/` routes exist
on the live API. The full catalog (kling, veo3.1, sora-2, minimax, seedance, wan,
flux, reve, nano-banana) is in that spec; swap routes via the `*_MODEL_PATH`
overrides if the account favors a different model.

## How generation flows

**Images** (`generate-post-image`) are synchronous when the render beats the
platform's hard 150-second request cap: submit → poll (2s→10s backoff, 110s
inline budget) → download → return a data URL, carousel contact-sheet
validation and retry included (the retry is skipped when the first render
already ate the clock). When the render is slower AND the call carried a
`client_context.client_id`, the function answers `202 {job_id}` instead and
the webhook finishes the job — same flow as video, handled in the frontend by
`resolveGenerationResult()`.

**Videos** (`generate-post-video`) chain two async jobs (brand-aligned seed
image → image-to-video), so they use a job row:

1. The function records a `media_jobs` row and registers
   `higgsfield-webhook?t=<secret>` on the submission.
2. The function answers `202 {job_id, status: "processing"}` immediately after
   submission — the 150s platform cap makes inline waiting for video
   impossible (seed generation alone can consume most of the window).
3. The webhook copies the finished media into the `generated-media` bucket
   (Higgsfield CDN URLs expire after ~7 days) and stamps the row; the frontend
   (`src/lib/mediaJobs.ts`) watches the row over realtime + polling.

Webhook deliveries can arrive more than once; the webhook only transitions
rows that are not already terminal, so duplicates are no-ops.

**Client context** still shapes every generation. Design references and a
PNG/JPG brand book are passed as short-lived signed URLs
(`reference_image_urls`). A **PDF brand book cannot be sent** — Higgsfield
accepts image inputs only — so its influence must come through
`design_style_synthesis` in the prompt. Any client with a PDF-only brand book
needs `synthesize-design-language` run once from Client Setup, or their
generations lose brand grounding (the functions log a warning when this
happens).

## Rate limits

Higgsfield limits **concurrency**, not request rate. Hitting the cap returns
HTTP 400 with a "Maximum number of concurrent requests (N)" message, which the
edge functions surface as a clear "at capacity, try again" error (HTTP 429 to
the frontend). The multi-variant UI fires variants in parallel, so with a low
account cap, 3 variants × several users can hit it; the error is retryable.

## Team MCP setup (ad hoc generation in Claude)

For designers/strategists who want Higgsfield directly in Claude Code or
Cowork, add the hosted MCP and sign in with your own Higgsfield account:

```bash
claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp
```

Then run `/mcp` inside Claude Code to complete the browser sign-in. This is
per-person and entirely separate from the app's REST credentials — nothing you
generate through the MCP touches Socialytics data unless you upload it.
